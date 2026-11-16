// Evaluador del código de usuario, compatible con la sintaxis de Strudel:
//   bpm(174)                       tempo (o setcpm / setcps / setCpm / setCps)
//   drums: s("bd ~ sn ~")          pista con nombre (admite acentos: batería:)
//   _bass: note("d1")              pista silenciada (prefijo o sufijo _)
//   $: s("hh*8")                   pista anónima
//   "0 2 4".add(3)                 las cadenas con comillas dobles admiten métodos (como Strudel)
//   stack(...)                     la última expresión suelta suena si no hay pistas
import * as api from './index.js';

const { Pattern, reify, controls } = api;

export const DEFAULT_BPM = 174;
const KEYWORD_RE = /^(const|let|var|function|async\s+function|class|if|for|while|do|switch|try|return|throw|import|export|break|continue|else|catch|finally)\b/;
const LABEL_RE = /^(_?)(\$|[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*)\s*:(?![:=])[ \t]*/u;
const CONT_END = new Set(['(', '[', '{', ',', '.', '+', '-', '*', '/', '%', '=', '<', '>', '!', '&', '|', '?', ':', '^', '~']);
const CONT_START = new Set(['.', ')', ']', '}', ',', '+', '-', '*', '/', '%', '=', '?', ':', '&', '|', '^', '>', '<']);
const CONT_WORDS = /^(else|catch|finally)\b/;
const REGEX_PREV = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_KEYWORDS = /(?:^|[^\w$])(return|typeof|case|do|else|in|of|new|delete|void|throw|instanceof|yield|await)$/;
const isSpace = (c) => c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === ' ';

// Primera posición desde from que no es espacio ni comentario (-1 si no hay más código)
export function skipTrivia(code, from) {
  const n = code.length;
  let j = from;
  while (j < n) {
    const c = code[j];
    if (isSpace(c)) j++;
    else if (c === '/' && code[j + 1] === '/') {
      while (j < n && code[j] !== '\n') j++;
    } else if (c === '/' && code[j + 1] === '*') {
      const e = code.indexOf('*/', j + 2);
      j = e < 0 ? n : e + 2;
    } else return j;
  }
  return -1;
}

// Análisis léxico mínimo: sentencias de nivel superior y literales de cadena
// (respeta comentarios, cadenas, plantillas con ${}, expresiones regulares y paréntesis).
export function lex(code) {
  const stmts = [];
  const strings = [];
  const n = code.length;
  let i = 0;
  let depth = 0;
  let cur = null;
  let prevSig = -1; // último carácter significativo (en cualquier estado)
  // literal = el carácter pertenece a una cadena o regex (su "/" o "+" final no es un operador)
  const touch = (pos, literal = false) => {
    if (!cur) cur = { firstSig: pos, lastSig: pos, literal };
    cur.lastSig = pos;
    cur.literal = literal;
    prevSig = pos;
  };
  const close = () => {
    if (cur) stmts.push({ start: cur.firstSig, end: cur.lastSig + 1 });
    cur = null;
  };
  const nextSignificant = (from) => skipTrivia(code, from);
  // salta un literal de cadena o plantilla que empieza en i; devuelve la posición siguiente
  const skipString = (start) => {
    const q = code[start];
    let j = start + 1;
    let interp = false;
    while (j < n) {
      const c = code[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === q) {
        j++;
        break;
      }
      if (q === '`' && c === '$' && code[j + 1] === '{') {
        interp = true;
        let d = 1;
        j += 2;
        while (j < n && d > 0) {
          const cc = code[j];
          if (cc === '\\') j++;
          else if (cc === '{') d++;
          else if (cc === '}') d--;
          else if (cc === '"' || cc === "'" || cc === '`') {
            j = skipString(j).end - 1;
          }
          j++;
        }
        continue;
      }
      if (q !== '`' && c === '\n') break; // cadena sin cerrar: el parser de JS dará el error
      j++;
    }
    return { end: Math.min(j, n), interp };
  };
  while (i < n) {
    const c = code[i];
    const d = code[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      const e = code.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const { end, interp } = skipString(i);
      strings.push({ start: i, end, quote: c, interp });
      for (let k = i; k < end; k++) if (!isSpace(code[k]) || c === '`') touch(k, true);
      i = end;
      continue;
    }
    if (c === '/') {
      const p = prevSig >= 0 ? code[prevSig] : null;
      const before = code.slice(Math.max(0, prevSig - 12), prevSig + 1);
      const isRegex = p === null || !cur || REGEX_PREV.has(p) || REGEX_KEYWORDS.test(before);
      if (isRegex) {
        let j = i + 1;
        let inClass = false;
        while (j < n) {
          const cc = code[j];
          if (cc === '\\') {
            j += 2;
            continue;
          }
          if (cc === '\n') break;
          if (cc === '[') inClass = true;
          else if (cc === ']') inClass = false;
          else if (cc === '/' && !inClass) {
            j++;
            break;
          }
          j++;
        }
        while (j < n && /[a-z]/i.test(code[j])) j++;
        for (let k = i; k < j; k++) touch(k, true);
        i = j;
        continue;
      }
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
    if (depth === 0 && c === ';') {
      close();
      i++;
      continue;
    }
    if (depth === 0 && c === '\n') {
      if (cur) {
        const prev = code[cur.lastSig];
        const prev2 = code.slice(cur.lastSig - 1, cur.lastSig + 1);
        const postfix = prev2 === '++' || prev2 === '--';
        const ni = nextSignificant(i + 1);
        const next = ni >= 0 ? code[ni] : null;
        const contEnd = !cur.literal && CONT_END.has(prev) && !postfix;
        const contStart = next !== null && (CONT_START.has(next) || CONT_WORDS.test(code.slice(ni, ni + 8)));
        if (!contEnd && !contStart) close();
      }
      i++;
      continue;
    }
    if (!isSpace(c)) touch(i);
    i++;
  }
  close();
  return { stmts, strings };
}

export function splitStatements(code) {
  return lex(code).stmts;
}

// Métodos de patrón válidos tras un literal: "0 2 4".add(3) -> mini("0 2 4").add(3)
// (incluye los que el propio código crea con register("x", ...) / define("x", ...))
const USER_METHOD_RE = /\b(?:register|define)\s*\(\s*(['"`])([\p{ID_Start}$_][\p{ID_Continue}$]*)\1/gu;
function patternMethodNames(code = '') {
  const names = new Set(Object.getOwnPropertyNames(Pattern.prototype));
  names.delete('constructor');
  for (const m of code.matchAll(USER_METHOD_RE)) names.add(m[2]);
  return names;
}

// Transforma etiquetas estilo Strudel, cadenas con métodos y marca expresiones sueltas.
// Nunca añade saltos de línea: los números de línea de los errores siguen cuadrando.
export function transpile(code) {
  const { stmts, strings } = lex(code);
  const methods = patternMethodNames(code);
  const edits = [];
  for (const s of strings) {
    if (s.quote === "'" || s.interp) continue;
    // admite comentarios entre la cadena y el método: "bd sn" // golpe + salto de línea + .fast(2)
    const j = skipTrivia(code, s.end);
    if (j < 0 || code[j] !== '.') continue;
    // nombres Unicode como en define()/register(): "bd sn".caída()
    const m = /^\.\s*([\p{ID_Start}$_][\p{ID_Continue}$‌‍]*)/u.exec(code.slice(j, j + 96));
    if (!m || !methods.has(m[1])) continue;
    edits.push({ pos: s.start, del: 0, ins: 'mini(', rank: 2 });
    edits.push({ pos: s.end, del: 0, ins: ')', rank: 2 });
  }
  let anon = 0;
  for (const st of stmts) {
    const text = code.slice(st.start, st.end);
    const label = LABEL_RE.exec(text);
    if (label && !['default', 'case'].includes(label[2])) {
      let raw = label[2];
      let muted = label[1] === '_';
      if (raw !== '$' && raw.length > 1 && raw.endsWith('_')) {
        muted = true;
        raw = raw.replace(/_+$/, '');
      }
      const name = raw === '$' ? `$${++anon}` : raw.length > 1 && raw.startsWith('$') ? raw.slice(1) : raw;
      edits.push({ pos: st.start, del: label[0].length, ins: `__track(${JSON.stringify(name)}, ${muted}, `, rank: 1 });
      edits.push({ pos: st.end, del: 0, ins: ')', rank: 1 });
    } else if (!KEYWORD_RE.test(text) && text[0] !== '{' && text[0] !== '}') {
      edits.push({ pos: st.start, del: 0, ins: '__expr(', rank: 1 });
      edits.push({ pos: st.end, del: 0, ins: ')', rank: 1 });
    }
  }
  // de atrás hacia delante; a igual posición se aplica primero lo más interno (mini)
  edits.sort((a, b) => b.pos - a.pos || b.rank - a.rank);
  let out = code;
  for (const e of edits) out = out.slice(0, e.pos) + e.ins + out.slice(e.pos + e.del);
  return out;
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function errorLine(err) {
  const m = /<anonymous>:(\d+):(\d+)/.exec(err?.stack || '');
  return m ? Number(m[1]) : null;
}

let measuredOffset = null;
async function lineOffset() {
  if (measuredOffset !== null) return measuredOffset;
  try {
    await new AsyncFunction('__scope', 'with (__scope) {\nthrow new Error("x")\n}')({});
  } catch (e) {
    const l = errorLine(e);
    measuredOffset = l !== null ? l - 1 : 0;
  }
  return measuredOffset;
}

const lineAt = (code, pos) => code.slice(0, pos).split('\n').length;

// Mensaje del error de sintaxis al compilar src (null si compila)
function compileMsg(src) {
  try {
    new AsyncFunction('__scope', `with (__scope) {\n${transpile(src)}\n}`);
    return null;
  } catch (e) {
    return e instanceof SyntaxError ? e.message : null;
  }
}

// Línea de un error de sintaxis: la primera sentencia en la que el código acumulado hasta ella falla con el
// mismo mensaje que el código entero (así un if/for sin llaves o las llaves en otra línea no confunden, y una
// declaración repetida también tiene línea). Si no, la primera sentencia que no compila sola.
function syntaxErrorLine(code) {
  const full = compileMsg(code);
  if (!full) return null;
  const stmts = lex(code).stmts;
  for (const st of stmts) if (compileMsg(code.slice(0, st.end)) === full) return lineAt(code, st.start);
  for (const st of stmts) if (compileMsg(code.slice(st.start, st.end))) return lineAt(code, st.start);
  return null;
}

// Ámbito aislado: las variables sin declarar no ensucian globalThis y los nombres que no
// existen dan error (una errata ya no silencia una pista sin avisar).
// Cada nombre que el código busca vuelve a apuntar el contexto de .p()/.play() a SU evaluación: si un cuerpo
// se reanuda tras un await mientras corre otra evaluación, sus pistas no acaban en la otra.
function makeScope(scope, ctx = null) {
  const locals = Object.create(null);
  return new Proxy(scope, {
    has: (t, k) => {
      if (ctx && ctx.alive) current = ctx;
      return typeof k === 'string' && k !== '__scope' && k !== 'arguments';
    },
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      if (k in locals) return locals[k];
      if (k in globalThis) return globalThis[k];
      throw new ReferenceError(`"${String(k)}" no está definido (¿una errata?)`);
    },
    set: (t, k, v) => {
      if (k in t) t[k] = v;
      else locals[k] = v;
      return true;
    },
  });
}

export class EvalError extends Error {
  constructor(message, line = null, cause = null) {
    super(message);
    this.name = 'EvalError';
    this.line = line;
    this.cause = cause;
  }
}

const mutedName = (name) => /^_|_$/.test(name);
const cleanName = (name) => name.replace(/^_+|_+$/g, '') || name;

// Contexto activo (para .p("nombre") y .play()).
let current = null;
Pattern.prototype.p = function (name) {
  if (!current) throw new Error('.p() sólo funciona dentro del editor');
  const n = String(name);
  current.addTrack(cleanName(n), this, mutedName(n));
  return this;
};
Pattern.prototype.play = function () {
  if (!current) throw new Error('.play() sólo funciona dentro del editor');
  current.addTrack(`play${current.tracks.length + 1}`, this, false);
  return this;
};

// define("nombre", (pat, ...args) => patrón): crea un método propio, p. ej. define("drop", p => p.lpf(300))
const userDefined = new Set();
const NAME_RE = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u;
function defineRaw(name, method) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new Error(`define(): nombre inválido "${name}"`);
  if (name in Pattern.prototype && !userDefined.has(name)) throw new Error(`"${name}" ya existe en Pulso; elige otro nombre`);
  userDefined.add(name);
  Pattern.prototype[name] = method;
}
export function defineMethod(name, fn) {
  if (typeof fn !== 'function') throw new Error('define(): el segundo argumento debe ser una función (pat, ...args) => patrón');
  defineRaw(name, function (...args) {
    const out = fn(this, ...args);
    if (out === undefined) throw new Error(`define("${name}"): la función devolvió undefined (¿falta return?)`);
    return reify(out);
  });
}
// register('nombre', (arg1, ..., pat) => patrón): firma de Strudel (el patrón va al final).
// Los argumentos admiten patrones/mini-notación, como en Strudel.
const isPlain = (a) => a == null || typeof a === 'number' || typeof a === 'boolean';
export function strudelRegister(name, fn) {
  if (typeof fn !== 'function') throw new Error('register(): el segundo argumento debe ser una función (...args, pat) => patrón');
  const nArgs = Math.max(0, fn.length - 1);
  const call = (pat, vals) => {
    const out = fn(...vals, pat);
    if (out === undefined) throw new Error(`register("${name}"): la función devolvió undefined (¿falta return?)`);
    return reify(out);
  };
  defineRaw(name, function (...args) {
    const pat = this;
    const pargs = args.slice(0, nArgs);
    while (pargs.length < nArgs) pargs.push(undefined);
    if (pargs.every(isPlain)) return call(pat, [...pargs, ...args.slice(nArgs)]);
    return api
      .sequenceArgs(pargs.map((a) => (a == null ? api.pure(a) : reify(a))))
      .fmap((vals) => call(pat, vals))
      .innerJoin();
  });
  return (...args) => reify(args[args.length - 1])[name](...args.slice(0, -1));
}

// Lo interno del motor no se expone al código de usuario.
const INTERNAL = new Set(['register', 'setStringParser', 'setNoteParser', 'setStepCounter', 'sequenceArgs']);
const userApi = Object.fromEntries(Object.entries(api).filter(([k]) => !INTERNAL.has(k)));

// Las evaluaciones ejecutan el cuerpo del código de una en una (protege el contexto de .p()/.play()).
// El turno se libera en cuanto termina el cuerpo (la carga de samples y la prueba de humo ya no lo bloquean)
// y nadie espera más de QUEUE_WAIT_MS a uno que se quedó colgado (p. ej. un await que nunca acaba).
export const QUEUE_WAIT_MS = 10000;
let queue = Promise.resolve();
function waitTurn(prev, ms) {
  let timer = null;
  const timeout = new Promise((r) => {
    timer = setTimeout(r, ms);
  });
  return Promise.race([prev, timeout]).finally(() => clearTimeout(timer));
}
export function evaluate(code, hooks = {}) {
  let release;
  const slot = new Promise((r) => {
    release = r;
  });
  const prev = queue;
  queue = slot;
  return waitTurn(prev, hooks.queueWait ?? QUEUE_WAIT_MS)
    .then(() => evaluateNow(code, hooks, release))
    .finally(release);
}

// Error.stackTraceLimit se sube mientras haya algún cuerpo en marcha y se restaura al acabar el último
// (con cuerpos solapados, restaurarlo en mitad de otro hacía perder la línea de sus errores).
let activeBodies = 0;
let baseStackLimit = Error.stackTraceLimit;
function enterBody() {
  if (activeBodies++ === 0) {
    baseStackLimit = Error.stackTraceLimit;
    try {
      Error.stackTraceLimit = Math.max(Number(baseStackLimit) || 10, 200);
    } catch {
      /* no ajustable en este motor */
    }
  }
}
function leaveBody() {
  if (--activeBodies === 0) {
    try {
      Error.stackTraceLimit = baseStackLimit;
    } catch {
      /* idem */
    }
  }
}

async function evaluateNow(code, hooks, release = () => {}) {
  const tracks = [];
  const alternates = []; // variantes A/B en reserva: no suenan, pero se validan
  const logs = [];
  const pending = [];
  const allFns = [];
  const duplicates = [];
  const warnings = [];
  let cps = DEFAULT_BPM / 60 / 4;
  let lastExpr = null;
  let lastForm = null;
  let usesSamples = false;
  const ctx = {
    tracks,
    alive: false,
    addTrack(name, pat, muted) {
      if (pat === undefined || pat === null) {
        throw new Error(`la pista "${name}" no tiene patrón (vale ${pat}); usa silence para callarla`);
      }
      const i = tracks.findIndex((t) => t.name === name);
      const entry = { name, pattern: reify(pat), muted: !!muted };
      if (i < 0) tracks.push(entry);
      else if (tracks[i].muted && !entry.muted) {
        alternates.push(tracks[i]); // variante A/B: gana la que suena; la muda queda en reserva
        tracks[i] = entry;
      } else if (!tracks[i].muted && entry.muted) {
        alternates.push(entry); // bass: ... y _bass: ... -> la muda es la alternativa en reserva; no es un duplicado
      } else {
        if (!entry.muted) duplicates.push(name); // dos versiones sonando: sólo suena la última
        else alternates.push(tracks[i]); // dos mudas: suena (si se activa) la última
        tracks[i] = entry;
      }
    },
  };
  const setcps = (c) => {
    cps = api.num(c);
  };
  const setcpm = (c) => {
    cps = api.num(c) / 60;
  };
  const scope = {
    ...userApi,
    ...controls,
    __track: (name, muted, pat) => {
      ctx.addTrack(name, pat, muted);
      return pat;
    },
    __expr: (v) => {
      if (v instanceof Pattern) lastExpr = v;
      return v;
    },
    track: (name, pat) => {
      const n = String(name);
      ctx.addTrack(cleanName(n), pat, mutedName(n));
      return pat;
    },
    bpm: (b, beatsPerCycle = 4) => {
      cps = api.num(b) / 60 / api.num(beatsPerCycle);
    },
    setcpm,
    setcps,
    setCpm: setcpm,
    setCps: setcps,
    hush: () => {
      tracks.length = 0;
      lastExpr = null;
    },
    samples: (...args) => {
      usesSamples = true;
      const desc = typeof args[0] === 'string' ? args[0] : 'mapa de samples';
      const p = (hooks.samples ? Promise.resolve().then(() => hooks.samples(...args)) : Promise.resolve()).catch((e) => {
        warnings.push(`No se pudieron cargar samples (${desc}): ${e.message}. Se usan los sonidos internos.`);
      });
      pending.push(p);
      return p;
    },
    form: (...a) => {
      lastForm = api.form(...a);
      return lastForm;
    },
    print: (...a) => {
      logs.push(a.map(String).join(' '));
    },
    // all(x => x.lpf(800)): transforma todas las pistas a la vez (se aplica al final)
    all: (f) => {
      if (typeof f !== 'function') throw new Error('all() necesita una función, p. ej. all(x => x.lpf(800))');
      allFns.push(f);
    },
    define: defineMethod,
    register: strudelRegister,
  };
  const body = `with (__scope) {\n${transpile(code)}\n}`;
  let fn;
  try {
    fn = new AsyncFunction('__scope', body);
  } catch (e) {
    const line = syntaxErrorLine(code);
    throw new EvalError(`Error de sintaxis: ${e.message}${line ? ` (línea ${line})` : ''}`, line, e);
  }
  ctx.alive = true;
  current = ctx;
  enterBody();
  try {
    await fn(makeScope(scope, ctx));
  } catch (e) {
    const off = await lineOffset();
    const l = errorLine(e);
    const line = l !== null ? l - off : null;
    throw new EvalError(`${e.message}${line ? ` (línea ${line})` : ''}`, line, e);
  } finally {
    ctx.alive = false;
    if (current === ctx) current = null;
    leaveBody();
    release(); // la siguiente evaluación ya puede ejecutar su cuerpo
  }
  await Promise.all(pending);
  if (tracks.length === 0 && lastExpr) tracks.push({ name: 'main', pattern: lastExpr, muted: false });
  if (!Number.isFinite(cps) || cps <= 0) throw new EvalError(`Tempo inválido (cps=${cps})`);
  const applyAll = (t, label) => {
    try {
      t.pattern = allFns.reduce((p, f) => {
        const out = f(p);
        if (out === undefined) throw new Error('la función devolvió undefined (¿falta return?)');
        return reify(out);
      }, t.pattern);
    } catch (e) {
      throw new EvalError(`all(): falló en la pista "${label}": ${e.message}`, null, e);
    }
  };
  for (const t of tracks) applyAll(t, t.name);
  for (const t of alternates) applyAll(t, `${t.name} (variante en reserva)`);
  // Prueba de humo sobre toda la forma (o 16 compases): los errores de secciones posteriores
  // (un acorde mal escrito en el drop) se detectan al evaluar, con su sección y compás.
  // Las variantes en reserva también se prueban: así el error sale antes de cambiar el _ en directo.
  const errors = [];
  const probe = lastForm ? Math.min(Math.ceil(lastForm.cycles), 512) : 16;
  const smoke = (t, label) => {
    try {
      t.pattern.queryArc(0, probe);
    } catch (e) {
      let where = '';
      for (let c = 0; c < probe; c++) {
        try {
          t.pattern.queryArc(c, c + 1);
        } catch {
          const sec = lastForm ? lastForm.at(c) : null;
          where = sec ? ` (sección ${sec.name}, compás ${c + 1})` : ` (compás ${c + 1})`;
          break;
        }
      }
      errors.push({ track: label, message: `${e.message}${where}` });
    }
  };
  for (const t of tracks) smoke(t, t.name);
  for (const t of alternates) smoke(t, `${t.name} (variante en reserva)`);
  return {
    tracks,
    alternates,
    cps,
    bpm: cps * 240,
    logs,
    errors,
    warnings,
    duplicates: [...new Set(duplicates)],
    usesSamples,
    form: lastForm,
  };
}
