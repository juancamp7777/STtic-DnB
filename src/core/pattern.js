// Núcleo de patrones: un patrón es una función que, dado un intervalo de tiempo
// (en ciclos), devuelve los eventos ("haps") que ocurren en él.
import { F, Fraction } from './fraction.js';
import { TimeSpan, Hap, State } from './timespan.js';

let stringParser = null;
export function setStringParser(fn) {
  stringParser = fn;
}

export class Pattern {
  constructor(query) {
    this.query = query;
  }

  queryArc(begin, end, controls = {}) {
    return this.query(new State(new TimeSpan(begin, end), controls));
  }

  // Eventos que empiezan dentro de [begin, end), ordenados: lo que suena.
  onsets(begin, end) {
    return this.queryArc(begin, end)
      .filter((h) => h.hasOnset())
      .sort((a, b) => a.whole.begin.compare(b.whole.begin));
  }

  splitQueries() {
    const pat = this;
    return new Pattern((st) => st.span.spanCycles().flatMap((span) => pat.query(st.setSpan(span))));
  }
  withQuerySpan(f) {
    const pat = this;
    return new Pattern((st) => pat.query(st.withSpan(f)));
  }
  withQueryTime(f) {
    return this.withQuerySpan((span) => span.withTime(f));
  }
  withHapSpan(f) {
    const pat = this;
    return new Pattern((st) => pat.query(st).map((h) => h.withSpan(f)));
  }
  withHapTime(f) {
    return this.withHapSpan((span) => span.withTime(f));
  }
  withHaps(f) {
    const pat = this;
    return new Pattern((st) => f(pat.query(st), st));
  }
  withValue(f) {
    const pat = this;
    return new Pattern((st) => pat.query(st).map((h) => h.withValue(f)));
  }
  fmap(f) {
    return this.withValue(f);
  }
  filterHaps(pred) {
    const pat = this;
    return new Pattern((st) => pat.query(st).filter(pred));
  }
  filterValues(pred) {
    return this.filterHaps((h) => pred(h.value));
  }
  onsetsOnly() {
    return this.filterHaps((h) => h.hasOnset());
  }
  // Cada evento se convierte en varios (mismo tiempo, distintos valores).
  flatValues(f) {
    const pat = this;
    return new Pattern((st) =>
      pat.query(st).flatMap((h) => f(h.value).map((v) => new Hap(h.whole, h.part, v, h.context))),
    );
  }

  // Estructura desde la izquierda (this), valores combinados con f.
  appLeft(other, f) {
    const pat = this;
    const right = reify(other);
    return new Pattern((st) => {
      const out = [];
      for (const hl of pat.query(st)) {
        for (const hr of right.query(st.setSpan(hl.wholeOrPart()))) {
          const part = hl.part.intersection(hr.part);
          if (!part) continue;
          out.push(new Hap(hl.whole, part, f(hl.value, hr.value), hl.context));
        }
      }
      return out;
    });
  }

  // Estructura desde la derecha (other).
  appRight(other, f) {
    const pat = this;
    const right = reify(other);
    return new Pattern((st) => {
      const out = [];
      for (const hr of right.query(st)) {
        for (const hl of pat.query(st.setSpan(hr.wholeOrPart()))) {
          const part = hl.part.intersection(hr.part);
          if (!part) continue;
          out.push(new Hap(hr.whole, part, f(hl.value, hr.value), hr.context));
        }
      }
      return out;
    });
  }

  // Patrón de patrones -> patrón. La estructura viene de los patrones internos.
  innerJoin() {
    const pat = this;
    return new Pattern((st) => {
      const out = [];
      for (const ho of pat.query(st)) {
        const inner = reify(ho.value);
        for (const hi of inner.query(st.setSpan(ho.part))) {
          const part = hi.part.intersection(ho.part);
          if (!part) continue;
          out.push(new Hap(hi.whole, part, hi.value, hi.context));
        }
      }
      return out;
    });
  }

  // La estructura viene del patrón externo; el valor se muestrea al inicio del evento.
  outerJoin() {
    const pat = this;
    return new Pattern((st) => {
      const out = [];
      for (const ho of pat.query(st)) {
        const inner = reify(ho.value);
        const t = ho.wholeOrPart().begin;
        for (const hi of inner.query(st.setSpan(new TimeSpan(t, t)))) {
          out.push(new Hap(ho.whole, ho.part, hi.value, ho.context));
        }
      }
      return out;
    });
  }

  // Cada ciclo del patrón interno se comprime dentro de cada evento externo.
  squeezeJoin() {
    const pat = this;
    return new Pattern((st) => {
      const out = [];
      for (const ho of pat.query(st)) {
        const span = ho.wholeOrPart();
        if (span.begin.eq(span.end)) continue;
        const inner = reify(ho.value)._focus(span.begin, span.end);
        for (const hi of inner.query(st.setSpan(ho.part))) {
          const part = hi.part.intersection(ho.part);
          if (!part) continue;
          let whole = null;
          if (hi.whole && ho.whole) {
            whole = hi.whole.intersection(ho.whole);
            if (!whole) continue;
          }
          out.push(new Hap(whole, part, hi.value, hi.context));
        }
      }
      return out;
    });
  }

  _focus(b, e) {
    b = F(b);
    e = F(e);
    return this._early(b.sam())._fast(F(1).div(e.sub(b)))._late(b);
  }

  // --- utilidades para depurar / tests ---
  show(begin = 0, end = 1) {
    return this.onsets(begin, end)
      .map((h) => `${h.whole.begin}-${h.whole.end}:${fmtValue(h.value)}`)
      .join(' ');
  }
}

function fmtValue(v) {
  if (v !== null && typeof v === 'object') {
    return Object.entries(v)
      .map(([k, x]) => `${k}=${x}`)
      .join(',');
  }
  return String(v);
}

// ---------------------------------------------------------------------------
// Helpers de valores
// ---------------------------------------------------------------------------
export const isPattern = (x) => x instanceof Pattern;
export const isObj = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Pattern) && !(v instanceof Fraction);
export const toObj = (v) => (isObj(v) ? v : v == null ? {} : { value: v });
export const range = (n) => Array.from({ length: Math.max(0, n) }, (_, i) => i);
export const mod = (a, b) => ((a % b) + b) % b;

export function num(x) {
  if (x instanceof Fraction) return x.valueOf();
  if (typeof x === 'number') return x;
  if (typeof x === 'boolean') return x ? 1 : 0;
  const v = Number(x);
  if (x === null || x === undefined || x === '' || Number.isNaN(v)) {
    throw new Error(`Se esperaba un número y llegó "${x}"`);
  }
  return v;
}
export const toFrac = (x) => (x instanceof Fraction ? x : F(num(x)));

export const truthy = (v) =>
  !(v === false || v === 0 || v === '0' || v === 'f' || v === 'false' || v == null || v === '~' || v === '-');

// ---------------------------------------------------------------------------
// Constructores básicos
// ---------------------------------------------------------------------------
export const silence = new Pattern(() => []);

export function pure(value) {
  return new Pattern((st) =>
    st.span.spanCycles().map((span) => {
      const sam = span.begin.sam();
      return new Hap(new TimeSpan(sam, sam.add(1)), span, value);
    }),
  );
}

export function reify(x) {
  if (x instanceof Pattern) return x;
  if (typeof x === 'string') {
    if (!stringParser) throw new Error('Mini-notación no cargada (importa core/index.js)');
    return stringParser(x);
  }
  if (Array.isArray(x)) return fastcat(...x);
  if (x === undefined) return silence;
  return pure(x);
}

export function stack(...pats) {
  const ps = pats.map(reify);
  return new Pattern((st) => ps.flatMap((p) => p.query(st)));
}

// Un elemento por ciclo; cada patrón "ve" sus propios ciclos (no salta ciclos).
export function slowcat(...pats) {
  if (pats.length === 1 && Array.isArray(pats[0])) pats = pats[0];
  const ps = pats.map(reify);
  if (ps.length === 0) return silence;
  if (ps.length === 1) return ps[0];
  const n = ps.length;
  return new Pattern((st) => {
    const sam = st.span.begin.sam();
    const c = sam.valueOf();
    const i = mod(c, n);
    const offset = sam.sub(Math.floor(c / n));
    return ps[i]._late(offset).query(st);
  }).splitQueries();
}

// Todos los elementos dentro de un ciclo.
export function fastcat(...pats) {
  if (pats.length === 1 && Array.isArray(pats[0])) pats = pats[0];
  if (pats.length === 0) return silence;
  if (pats.length === 1) return reify(pats[0]);
  return slowcat(...pats)._fast(pats.length);
}

// Elige patrón según el ciclo, sin desplazar el tiempo.
export function cycleChoose(pats) {
  const ps = pats.map(reify);
  if (ps.length === 0) return silence;
  const n = ps.length;
  return new Pattern((st) => ps[mod(st.span.begin.sam().valueOf(), n)].query(st)).splitQueries();
}

// Secuencia con pesos: timecat([3, a], [1, b])
export function timecat(...pairs) {
  if (pairs.length === 1 && Array.isArray(pairs[0]) && Array.isArray(pairs[0][0])) pairs = pairs[0];
  let total = F(0);
  for (const [w] of pairs) total = total.add(toFrac(w));
  if (total.lte(0)) return silence;
  let begin = F(0);
  const parts = [];
  for (const [w, p] of pairs) {
    const wf = toFrac(w);
    if (wf.lte(0)) continue;
    const end = begin.add(wf);
    parts.push(reify(p)._compress(begin.div(total), end.div(total)));
    begin = end;
  }
  return stack(...parts);
}

// Polimetría: cada secuencia avanza a `steps` pasos por ciclo. Acepta arrays o mini-notación
// ("c eb g"); el número de pasos de cada una se cuenta para alinearlas.
let stepCounter = null;
export function setStepCounter(fn) {
  stepCounter = fn;
}
function stepsOf(s) {
  if (Array.isArray(s)) return s.length;
  if (typeof s === 'string' && stepCounter) return stepCounter(s);
  return null;
}
export function polymeterSteps(steps, ...seqs) {
  const items = seqs.filter((s) => s != null && !(Array.isArray(s) && s.length === 0));
  if (items.length === 0) return silence;
  const base = F(num(steps));
  return stack(
    ...items.map((s) => {
      const k = stepsOf(s);
      if (!k) throw new Error('polymeter(): no sé cuántos pasos tiene este patrón; usa arrays o mini-notación ("a b c")');
      return (Array.isArray(s) ? fastcat(...s) : reify(s))._fast(base.div(k));
    }),
  );
}
export function polymeter(...seqs) {
  const items = seqs.filter((s) => s != null && !(Array.isArray(s) && s.length === 0));
  if (items.length === 0) return silence;
  const k = stepsOf(items[0]);
  if (!k) throw new Error('polymeter(): no sé cuántos pasos tiene este patrón; usa arrays o mini-notación ("a b c")');
  return polymeterSteps(k, ...items);
}

// Estructura de canción: arrange([8, intro], [16, drop], ...)
// Cada sección se reproduce desde su propio ciclo 0 y el arreglo completo se repite.
// Las secciones pueden durar fracciones de compás (un fill de medio compás): las consultas
// se parten exactamente en los límites de cada sección.
export function arrange(...sections) {
  const secs = sections.map(([len, pat]) => [toFrac(len), reify(pat)]).filter(([len]) => len.gt(0));
  if (secs.length === 0) return silence;
  const starts = [];
  let acc = F(0);
  for (const [len] of secs) {
    starts.push(acc);
    acc = acc.add(len);
  }
  const total = acc;
  const locate = (t) => {
    const loopStart = t.sub(t.mod(total));
    const pos = t.sub(loopStart);
    for (let i = 0; i < secs.length; i++) {
      const end = starts[i].add(secs[i][0]);
      if (pos.lt(end)) return { i, begin: loopStart.add(starts[i]), end: loopStart.add(end) };
    }
    const i = secs.length - 1;
    return { i, begin: loopStart.add(starts[i]), end: loopStart.add(total) };
  };
  return new Pattern((st) => {
    const { begin, end } = st.span;
    if (begin.eq(end)) {
      const s = locate(begin);
      return secs[s.i][1]._late(s.begin).query(st);
    }
    const out = [];
    let b = begin;
    while (b.lt(end)) {
      const s = locate(b);
      const e = s.end.lt(end) ? s.end : end;
      for (const h of secs[s.i][1]._late(s.begin).query(st.setSpan(new TimeSpan(b, e)))) out.push(h);
      b = e;
    }
    return out;
  });
}
export const arrangeLength = (...sections) => sections.reduce((a, [len]) => a + num(len), 0);

// Forma de canción con secciones con nombre (mejora sobre Strudel):
//   const F = form("intro:8 build:8 drop:16 break:8 drop:16 outro:8")
//   drums: F({ build: drumsLite, "drop outro": drumsFull })
// Las secciones que no aparecen quedan en silencio. F.at(ciclo) dice en qué sección estás; F.cycles es la duración total.
export function form(spec) {
  const sections = (Array.isArray(spec) ? spec : String(spec).trim().split(/\s+/)).map((item) => {
    if (Array.isArray(item)) return { name: String(item[0]), length: num(item[1]) };
    const [name, len] = String(item).split(':');
    const length = num(len ?? 1);
    if (!name || !(length > 0)) throw new Error(`form(): sección inválida "${item}"`);
    return { name, length };
  });
  if (sections.length === 0) throw new Error('form(): necesita al menos una sección');
  const total = sections.reduce((a, s) => a + s.length, 0);
  const names = new Set(sections.map((s) => s.name));
  const F = (parts) => {
    const map = new Map();
    for (const [key, pat] of Object.entries(parts || {})) {
      for (const k of key.split(/[\s,|]+/).filter(Boolean)) {
        if (!names.has(k)) throw new Error(`form(): la sección "${k}" no existe (hay: ${[...names].join(', ')})`);
        map.set(k, pat);
      }
    }
    return arrange(...sections.map((s) => [s.length, map.has(s.name) ? map.get(s.name) : silence]));
  };
  F.sections = sections;
  F.cycles = total;
  F.at = (cycle) => {
    const pos = mod(cycle, total);
    let start = 0;
    for (const s of sections) {
      if (pos < start + s.length - 1e-9) {
        return { name: s.name, index: sections.indexOf(s), bar: Math.floor(pos - start + 1e-9), pos: pos - start, length: s.length };
      }
      start += s.length;
    }
    const last = sections[sections.length - 1];
    return { name: last.name, index: sections.length - 1, bar: Math.max(0, Math.ceil(last.length) - 1), pos: last.length, length: last.length };
  };
  F.startOf = (name) => {
    let start = 0;
    for (const s of sections) {
      if (s.name === name) return start;
      start += s.length;
    }
    return null;
  };
  return F;
}

export function run(n) {
  if (n instanceof Pattern || typeof n === 'string') return reify(n).fmap((v) => run(num(v))).innerJoin();
  return fastcat(...range(Math.round(num(n))));
}

// La sucesión de Fibonacci como patrón, un número por paso: fib(8) = 0 1 1 2 3 5 8 13.
// Con módulo, fib(16, 7) = 0 1 1 2 3 5 1 6 0 6 6 5 4 2 6 1: módulo 7 la sucesión se repite justo cada 16
// números (periodo de Pisano), así que n(fib(16, 7)).scale("A4:minor") es una melodía de 16 semicorcheas
// sobre las 7 notas de la escala. La longitud y el módulo pueden ser patrones: fib(16, "<7 5>").
export function fibonacciList(len, m = null) {
  const n = Math.round(num(len));
  const md = m === null || m === undefined ? null : Math.round(num(m));
  if (!(n >= 1)) throw new Error(`fib(): la longitud tiene que ser 1 o más (llegó ${len})`);
  // con módulo, a + b < 2·módulo tiene que ser exacto en un número de JS (hasta 2^53)
  if (md !== null && !(md >= 1 && md <= 2 ** 52)) throw new Error(`fib(): el módulo tiene que ser un entero entre 1 y 2^52 (llegó ${m})`);
  // sin módulo, F(0)...F(78) son exactos; F(79) ya pasa de 2^53 y se redondearía
  const max = md === null ? 79 : 4096;
  if (n > max) throw new Error(`fib(): como mucho ${max} números${md === null ? ' (usa un módulo para más)' : ''}`);
  const out = [];
  let a = 0;
  let b = 1;
  for (let i = 0; i < n; i++) {
    out.push(md === null ? a : a % md);
    [a, b] = md === null ? [b, a + b] : [b, (a + b) % md];
  }
  return out;
}
export function fib(len = 16, m = null) {
  const isPat = (x) => x instanceof Pattern || typeof x === 'string';
  if (isPat(len) || isPat(m)) {
    return sequenceArgs([reify(len), m === null || m === undefined ? pure(null) : reify(m)])
      .fmap(([l, mm]) => fib(num(l), mm === null ? null : num(mm)))
      .innerJoin();
  }
  return fastcat(...fibonacciList(len, m));
}

// ---------------------------------------------------------------------------
// Aleatoriedad determinista (misma semilla de tiempo => mismo resultado)
// ---------------------------------------------------------------------------
const xorwise = (x) => {
  const a = (x << 13) ^ x;
  const b = (a >> 17) ^ a;
  return (b << 5) ^ b;
};
const fract = (x) => x - Math.floor(x);
const timeToIntSeed = (x) => xorwise(Math.trunc(fract(x / 300) * 536870912));
const intSeedToRand = (x) => (x % 536870912) / 536870912;
export const timeToRand = (x) => Math.abs(intSeedToRand(timeToIntSeed(x)));
const randAt = (t, seed = 0) => timeToRand(num(t) + seed);

// ---------------------------------------------------------------------------
// Señales continuas
// ---------------------------------------------------------------------------
export const signal = (f) => new Pattern((st) => [new Hap(null, st.span, f(st.span.begin.valueOf()))]);
export const steady = (v) => new Pattern((st) => [new Hap(null, st.span, v)]);
export const saw = signal((t) => fract(t));
export const isaw = signal((t) => 1 - fract(t));
export const sine = signal((t) => (Math.sin(2 * Math.PI * t) + 1) / 2);
export const tri = signal((t) => {
  const p = fract(t);
  return p < 0.5 ? 2 * p : 2 - 2 * p;
});
export const square = signal((t) => (fract(t) < 0.5 ? 0 : 1));
export const rand = signal((t) => timeToRand(t));
export const perlin = signal((t) => {
  const a = Math.floor(t);
  const p = t - a;
  const s = p * p * (3 - 2 * p);
  const ra = timeToRand(a);
  const rb = timeToRand(a + 1);
  return ra + s * (rb - ra);
});
export const brand = rand.fmap((r) => r < 0.5);
export const irand = (n) => rand.fmap((r) => Math.floor(r * num(n)));
export const time = signal((t) => t);

export function choose(...xs) {
  if (xs.length === 1 && Array.isArray(xs[0])) xs = xs[0];
  return rand.fmap((r) => xs[Math.min(xs.length - 1, Math.floor(r * xs.length))]);
}
export function wchoose(...pairs) {
  const total = pairs.reduce((a, [, w]) => a + num(w), 0);
  return rand.fmap((r) => {
    let acc = 0;
    for (const [v, w] of pairs) {
      acc += num(w) / total;
      if (r < acc) return v;
    }
    return pairs[pairs.length - 1][0];
  });
}
// Un patrón distinto (al azar) cada ciclo.
export function randcatSeeded(pats, seed = 0) {
  const ps = pats.map(reify);
  if (ps.length === 0) return silence;
  return new Pattern((st) => {
    const c = st.span.begin.sam().valueOf();
    const i = Math.min(ps.length - 1, Math.floor(randAt(c, seed + 0.5) * ps.length));
    return ps[i].query(st);
  }).splitQueries();
}
export const chooseCycles = (...pats) => randcatSeeded(pats);
export const randcat = chooseCycles;

// ---------------------------------------------------------------------------
// Registro de métodos con argumentos "patroneables"
// ---------------------------------------------------------------------------
const isPlainArg = (a) => a == null || typeof a === 'number' || typeof a === 'boolean' || a instanceof Fraction;

export function sequenceArgs(pats) {
  if (pats.length === 0) return pure([]);
  let acc = pats[0].fmap((v) => [v]);
  for (const p of pats.slice(1)) acc = acc.appLeft(p, (a, b) => [...a, b]);
  return acc;
}

export function register(name, nPat, fn) {
  Pattern.prototype['_' + name] = function (...args) {
    return fn(this, ...args);
  };
  Pattern.prototype[name] = function (...args) {
    const pargs = args.slice(0, nPat);
    if (pargs.every(isPlainArg)) return fn(this, ...args);
    const rest = args.slice(nPat);
    const pat = this;
    const argPats = pargs.map((a) => (a == null ? pure(a) : reify(a)));
    return sequenceArgs(argPats)
      .fmap((vals) => fn(pat, ...vals, ...rest))
      .innerJoin();
  };
}

// --- tiempo ---
register('fast', 1, (pat, factor) => {
  const r = toFrac(factor);
  if (r.eq(0)) return silence;
  if (r.lt(0)) return pat._fast(r.neg())._rev();
  return pat.withQueryTime((t) => t.mul(r)).withHapTime((t) => t.div(r));
});
register('slow', 1, (pat, factor) => {
  const r = toFrac(factor);
  if (r.eq(0)) return silence;
  return pat._fast(F(1).div(r));
});
register('early', 1, (pat, o) => {
  const off = toFrac(o);
  if (off.eq(0)) return pat;
  return pat.withQueryTime((t) => t.add(off)).withHapTime((t) => t.sub(off));
});
register('late', 1, (pat, o) => pat._early(toFrac(o).neg()));
register('rev', 0, (pat) =>
  new Pattern((st) => {
    const span = st.span;
    const cycle = span.begin.sam();
    const next = cycle.add(1);
    const reflect = (s) => new TimeSpan(cycle.add(next.sub(s.end)), cycle.add(next.sub(s.begin)));
    return pat.query(st.setSpan(reflect(span))).map((h) => h.withSpan(reflect));
  }).splitQueries(),
);
register('ply', 1, (pat, n) => {
  const k = toFrac(n);
  if (k.lte(0)) return silence;
  return pat.fmap((v) => pure(v)._fast(k)).squeezeJoin();
});
register('segment', 1, (pat, n) => pure(true)._fast(n).appLeft(pat, (a, b) => b));
register('compress', 2, (pat, b, e) => {
  b = toFrac(b);
  e = toFrac(e);
  if (b.gte(e) || b.lt(0) || e.gt(1)) return silence;
  const d = e.sub(b);
  return new Pattern((st) => {
    const out = [];
    for (const span of st.span.spanCycles()) {
      const c = span.begin.sam();
      const lo = c.add(b);
      const hi = c.add(e);
      const ib = span.begin.max(lo);
      const ie = span.end.min(hi);
      if (ib.gt(ie)) continue;
      if (ib.eq(ie)) {
        if (!span.begin.eq(span.end) || ib.eq(hi)) continue;
      }
      const toInner = (t) => c.add(t.sub(lo).div(d));
      const toOuter = (t) => lo.add(t.sub(c).mul(d));
      for (const h of pat.query(st.setSpan(new TimeSpan(toInner(ib), toInner(ie))))) {
        out.push(h.withSpan((s) => s.withTime(toOuter)));
      }
    }
    return out;
  });
});
register('fastGap', 1, (pat, n) => {
  const k = toFrac(n);
  if (k.lte(0)) return silence;
  return pat._compress(0, F(1).div(k));
});
register('zoom', 2, (pat, b, e) => {
  b = toFrac(b);
  e = toFrac(e);
  const d = e.sub(b);
  if (d.lte(0)) return silence;
  // El mapeo se hace siempre respecto al ciclo de la consulta (no al del evento):
  // así un evento largo que empezó en otro ciclo conserva whole/part coherentes.
  return new Pattern((st) =>
    st.span.spanCycles().flatMap((span) => {
      const c = span.begin.sam();
      const toInner = (t) => c.add(t.sub(c).mul(d)).add(b);
      const toOuter = (t) => c.add(t.sub(c).sub(b).div(d));
      return pat
        .query(st.setSpan(new TimeSpan(toInner(span.begin), toInner(span.end))))
        .map((h) => h.withSpan((s) => s.withTime(toOuter)));
    }),
  );
});
// linger(0.25) repite el primer cuarto; linger(-0.25) repite el último cuarto (como Tidal/Strudel)
register('linger', 1, (pat, t) => {
  t = toFrac(t);
  if (t.eq(0)) return silence;
  if (t.gte(1) || t.lte(-1)) return pat;
  if (t.lt(0)) return pat._zoom(F(1).add(t), 1)._slow(t.neg());
  return pat._zoom(0, t)._slow(t);
});
// ribbon(desde, compases): repite un tramo del patrón. Como en Strudel, la duración puede ser fraccionaria
// (ribbon(29, .5)): la consulta se trocea en cada vuelta k = [k·len, (k+1)·len) y ahí suena el original desde "desde".
register('ribbon', 2, (pat, offset, cycles) => {
  const off = toFrac(offset);
  const len = toFrac(cycles);
  if (!(len.valueOf() > 0)) return silence;
  const lap = (st, b, e) => {
    const k = b.div(len).floor();
    return pat._early(off.sub(len.mul(k))).query(st.setSpan(new TimeSpan(b, e)));
  };
  return new Pattern((st) => {
    const { begin, end } = st.span;
    if (begin.eq(end)) return lap(st, begin, end);
    const out = [];
    let b = begin;
    while (b.lt(end)) {
      const e = len.mul(b.div(len).floor().add(1)).min(end);
      for (const h of lap(st, b, e)) out.push(h);
      b = e;
    }
    return out;
  });
});
register('swingBy', 2, (pat, x, n) => pat.inside(n, (p) => p._within(0.5, 1, (q) => q._late(x))));
register('swing', 1, (pat, n) => pat._swingBy(F(1).div(3), n));
register('hurry', 1, (pat, r) =>
  pat._fast(r).fmap((v) => {
    const o = toObj(v);
    return { ...o, speed: (o.speed ?? 1) * num(r) };
  }),
);
register('pressBy', 1, (pat, r) => pat.fmap((v) => pure(v)._compress(r, 1)).squeezeJoin());
register('press', 0, (pat) => pat._pressBy(0.5));
// iter/iterBack como Tidal/Strudel: slowcat (cada variante ve sus propios ciclos)
register('iter', 1, (pat, n) => {
  n = Math.max(1, Math.round(num(n)));
  return slowcat(...range(n).map((i) => pat._early(F(i).div(n))));
});
register('iterBack', 1, (pat, n) => {
  n = Math.max(1, Math.round(num(n)));
  return slowcat(...range(n).map((i) => pat._late(F(i).div(n))));
});
register('palindrome', 0, (pat) => cycleChoose([pat, pat._rev()]));
register('brak', 0, (pat) => cycleChoose([pat, fastcat(pat, silence)._late(new Fraction(1, 4))]));

Pattern.prototype.inside = function (n, f) {
  const k = toFrac(n);
  return f(this._slow(k))._fast(k);
};
Pattern.prototype.outside = function (n, f) {
  return this.inside(F(1).div(toFrac(n)), f);
};

// --- condicionales ---
const playWhenPos = (pat, pred) => pat.filterHaps((h) => pred(h.wholeOrPart().begin.cyclePos()));
register('within', 2, (pat, b, e, f) => {
  b = toFrac(b);
  e = toFrac(e);
  const inside = (p) => p.gte(b) && p.lt(e);
  return stack(
    playWhenPos(f(pat), inside),
    playWhenPos(pat, (p) => !inside(p)),
  );
});
register('firstOf', 1, (pat, n, f) => {
  n = Math.max(1, Math.round(num(n)));
  return cycleChoose([f(pat), ...Array(n - 1).fill(pat)]);
});
register('every', 1, (pat, n, f) => pat._firstOf(n, f));
register('lastOf', 1, (pat, n, f) => {
  n = Math.max(1, Math.round(num(n)));
  return cycleChoose([...Array(n - 1).fill(pat), f(pat)]);
});
register('whenmod', 2, (pat, a, b, f) => {
  const fp = f(pat);
  const A = num(a);
  const B = num(b);
  return new Pattern((st) => (mod(st.span.begin.sam().valueOf(), A) >= B ? fp : pat).query(st)).splitQueries();
});
// chunk como Tidal/Strudel (slowcat); fastChunk es la variante que no repite ciclos
// repeatCycles(n): cada ciclo del patrón se repite n veces (como Strudel/Tidal)
register('repeatCycles', 1, (pat, n) => {
  const k = Math.max(1, Math.round(num(n)));
  return new Pattern((st) => {
    const c = st.span.begin.sam();
    return pat._late(c.sub(F(Math.floor(c.valueOf() / k)))).query(st);
  }).splitQueries();
});
// chunk como Strudel 1.2.6: el patrón base repite cada ciclo n veces (así el trozo transformado recorre
// el mismo material) y f se lee en tiempo absoluto (sus propios argumentos <...> avanzan cada compás)
register('chunk', 1, (pat, n, f) => {
  n = Math.max(1, Math.round(num(n)));
  const rc = pat._repeatCycles(n);
  return cycleChoose(range(n).map((i) => rc._within(F(i).div(n), F(i + 1).div(n), f)));
});
// chunkBack como Strudel 1.2.6: Q0, Q3, Q2, Q1...
register('chunkBack', 1, (pat, n, f) => {
  n = Math.max(1, Math.round(num(n)));
  const rc = pat._repeatCycles(n);
  return cycleChoose(range(n).map((i) => {
    const k = mod(-i, n);
    return rc._within(F(k).div(n), F(k + 1).div(n), f);
  }));
});
register('fastChunk', 1, (pat, n, f) => {
  n = Math.max(1, Math.round(num(n)));
  return cycleChoose(range(n).map((i) => pat._within(F(i).div(n), F(i + 1).div(n), f)));
});
// sinónimos de Strudel (el código pegado de strudel.cc funciona igual)
for (const [alias, name] of [
  ['slowchunk', 'chunk'],
  ['slowChunk', 'chunk'],
  ['chunkback', 'chunkBack'],
  ['fastchunk', 'fastChunk'],
]) {
  Pattern.prototype[alias] = Pattern.prototype[name];
  Pattern.prototype['_' + alias] = Pattern.prototype['_' + name];
}
Pattern.prototype.when = function (cond, f) {
  const fp = f(this);
  const pat = this;
  return reify(cond)
    .fmap((x) => (truthy(x) ? fp : pat))
    .innerJoin();
};

// --- aleatorio ---
register('degradeBy', 1, (pat, p, seed = 0) => {
  const x = num(p);
  return pat.filterHaps((h) => randAt(h.wholeOrPart().begin, seed) >= x);
});
// como Strudel: undegradeBy(x) deja pasar 1 - x (lo que degradeBy(1 - x) quitaría), así que
// degradeBy(x) y undegradeBy(1 - x) se reparten los golpes sin repetir ninguno
register('undegradeBy', 1, (pat, p, seed = 0) => {
  const x = num(p);
  return pat.filterHaps((h) => 1 - randAt(h.wholeOrPart().begin, seed) >= x);
});
register('degrade', 0, (pat) => pat._degradeBy(0.5));
register('sometimesBy', 1, (pat, p, f) => stack(pat._degradeBy(p), f(pat._undegradeBy(1 - num(p)))));
register('someCyclesBy', 1, (pat, p, f) => {
  const fp = f(pat);
  const x = num(p);
  return new Pattern((st) => (timeToRand(st.span.begin.sam().valueOf()) < x ? fp : pat).query(st)).splitQueries();
});
const probs = { sometimes: 0.5, often: 0.75, rarely: 0.25, almostNever: 0.1, almostAlways: 0.9 };
for (const [name, p] of Object.entries(probs)) {
  Pattern.prototype[name] = function (f) {
    return this._sometimesBy(p, f);
  };
}
Pattern.prototype.someCycles = function (f) {
  return this._someCyclesBy(0.5, f);
};
Pattern.prototype.always = function (f) {
  return f(this);
};
Pattern.prototype.never = function () {
  return this;
};

// --- estructura ---
Pattern.prototype.struct = function (b) {
  return reify(b)
    .filterValues(truthy)
    .appLeft(this, (_, v) => v);
};
Pattern.prototype._struct = Pattern.prototype.struct;
Pattern.prototype.mask = function (b) {
  return this.appLeft(reify(b), (v, m) => [v, m])
    .filterValues(([, m]) => truthy(m))
    .fmap(([v]) => v);
};
Pattern.prototype.superimpose = function (...fs) {
  return stack(this, ...fs.map((f) => f(this)));
};
Pattern.prototype.layer = function (...fs) {
  return stack(...fs.map((f) => f(this)));
};
register('off', 1, (pat, t, f) => stack(pat, f(pat._late(t))));
Pattern.prototype.juxBy = function (by, f) {
  const d = num(by) / 2;
  const panned = (delta) =>
    this.fmap((v) => {
      const o = toObj(v);
      return { ...o, pan: Math.min(1, Math.max(0, (o.pan ?? 0.5) + delta)) };
    });
  return stack(panned(-d), f(panned(d)));
};
Pattern.prototype.jux = function (f) {
  return this.juxBy(1, f);
};
const mulGain = (v, g) => {
  const o = toObj(v);
  return { ...o, gain: (o.gain ?? 1) * g };
};
register('echo', 3, (pat, times, t, fb) => {
  const n = Math.max(1, Math.round(num(times)));
  const dt = toFrac(t);
  const g = num(fb);
  return stack(...range(n).map((i) => pat._late(dt.mul(i)).fmap((v) => (i === 0 ? v : mulGain(v, g ** i)))));
});
register('stut', 3, (pat, times, fb, t) => pat._echo(times, t, fb));
// echoWith(veces, tiempo, (copia, i) => ...): cada copia i (también la 0) va retrasada i*tiempo y pasa por f
register('echoWith', 2, (pat, times, t, f) => {
  const n = Math.max(1, Math.round(num(times)));
  const dt = toFrac(t);
  return stack(...range(n).map((i) => reify(f(pat._late(dt.mul(i)), i))));
});
for (const alias of ['stutWith', 'echowith', 'stutwith']) {
  Pattern.prototype[alias] = Pattern.prototype.echoWith;
  Pattern.prototype['_' + alias] = Pattern.prototype._echoWith;
}

// --- trocear un ciclo: bite / shuffle / scramble ---
// bite(4, "0 2 1 3"): divide el ciclo en 4 trozos y los toca en ese orden
register('bite', 1, (pat, n, ipat) => {
  n = Math.max(1, Math.round(num(n)));
  return reify(ipat)
    .fmap((i) => {
      const k = mod(Math.floor(num(i)), n);
      return pat._zoom(F(k).div(n), F(k + 1).div(n));
    })
    .squeezeJoin();
});
// permutación determinista por ciclo (cada trozo suena una vez por ciclo)
function permutationPattern(n, seed = 0) {
  return new Pattern((st) => {
    const c = st.span.begin.sam().valueOf();
    const order = range(n);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(timeToRand(c + seed + i * 0.0137) * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return fastcat(...order).query(st);
  }).splitQueries();
}
// shuffle/scramble como Strudel: cada trozo se toca con su propio tiempo (innerJoin), así una nota
// larga o un chop de break que ocupa varios trozos no se vuelve a disparar en cada uno.
function rearrange(ipat, n, pat) {
  const pats = range(n).map((i) => pat._zoom(F(i).div(n), F(i + 1).div(n)));
  return ipat.fmap((i) => pats[mod(Math.floor(num(i)), n)]._repeatCycles(n)._fast(n)).innerJoin();
}
register('shuffle', 1, (pat, n) => {
  n = Math.max(1, Math.round(num(n)));
  return rearrange(permutationPattern(n), n, pat);
});
register('scramble', 1, (pat, n) => {
  n = Math.max(1, Math.round(num(n)));
  return rearrange(irand(n)._segment(n), n, pat);
});

// --- elegir patrones por índice o nombre ---
// "<0 1 2>".pick([a, b, c])  o  "<a b>".pick({ a: ..., b: ... })
// Como Strudel: pick/inhabit redondean y recortan el índice; pickmod/inhabitmod dan la vuelta.
function lookupPick(lookup, key, wrap = false) {
  // n("<0 1>").pick([...]) también vale: un objeto de un solo campo ({ n: 0 }) se usa como su valor
  if (key && typeof key === 'object' && !Array.isArray(key)) {
    const vals = Object.values(key);
    if (vals.length === 1) key = vals[0];
  }
  if (Array.isArray(lookup)) {
    if (lookup.length === 0) return silence;
    const k = Math.round(num(key));
    return reify(lookup[wrap ? mod(k, lookup.length) : Math.min(Math.max(k, 0), lookup.length - 1)]);
  }
  if (lookup && typeof lookup === 'object') {
    if (!(key in lookup)) throw new Error(`pick(): no existe la clave "${key}" (hay: ${Object.keys(lookup).join(', ')})`);
    return reify(lookup[key]);
  }
  throw new Error('pick(): necesita un array o un objeto');
}
Pattern.prototype.pick = function (lookup) {
  return this.fmap((k) => lookupPick(lookup, k)).innerJoin();
};
Pattern.prototype.pickmod = function (lookup) {
  return this.fmap((k) => lookupPick(lookup, k, true)).innerJoin();
};
Pattern.prototype.inhabit = function (lookup) {
  return this.fmap((k) => lookupPick(lookup, k)).squeezeJoin();
};
Pattern.prototype.inhabitmod = function (lookup) {
  return this.fmap((k) => lookupPick(lookup, k, true)).squeezeJoin();
};
Pattern.prototype.pickSqueeze = Pattern.prototype.inhabit;
Pattern.prototype.pickmodSqueeze = Pattern.prototype.inhabitmod;
const isLookup = (x) => Array.isArray(x) || isObj(x);
// funciones: aceptan los dos órdenes de argumentos, como Strudel
export const pick = (a, b) => (isLookup(b) ? reify(a).pick(b) : reify(b).pick(a));
export const pickmod = (a, b) => (isLookup(b) ? reify(a).pickmod(b) : reify(b).pickmod(a));
export const inhabit = (a, b) => (isLookup(b) ? reify(a).inhabit(b) : reify(b).inhabit(a));
export const inhabitmod = (a, b) => (isLookup(b) ? reify(a).inhabitmod(b) : reify(b).inhabitmod(a));
// squeeze(patrón, lista) como en la documentación de Strudel (índice con vuelta, comprimido en cada evento)
export const squeeze = (pat, xs) => (isLookup(pat) && !isLookup(xs) ? reify(xs).inhabitmod(pat) : reify(pat).inhabitmod(xs));

// beat("0,7,10", 16): golpes en esos pasos de una rejilla de 16 (también patroneado: beat("<0 8>,10", 16))
// beat(pasos, div): un golpe de 1/div en cada paso, con el valor que tenga el patrón en ese momento (como Strudel).
// Los pasos separados por comas o espacios (o en un array) son un CONJUNTO y cada uno puede ser un patrón:
// beat("0,7,10", 16) · beat("0 <4 6> 10", 16) · beat("0 .. 3", 16) = pasos 0, 1, 2 y 3.
function splitTopLevel(str) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of str) {
    if ('[<{('.includes(ch)) depth++;
    else if (']>})'.includes(ch)) depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ',' || /\s/.test(ch))) {
      if (cur) parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}
// "0 .. 3" o "0..3" dentro de los pasos = 0 1 2 3 (en el resto de la mini-notación un rango ocupa un paso)
function expandStepRanges(tokens) {
  const out = [];
  const push = (a, b) => {
    const step = a <= b ? 1 : -1;
    for (let k = a; step > 0 ? k <= b : k >= b; k += step) {
      out.push(String(k));
      if (out.length > 4096) throw new Error('beat(): el rango de pasos es demasiado grande');
    }
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const m = /^(-?\d+)\.\.(-?\d+)$/.exec(t);
    if (m) push(Number(m[1]), Number(m[2]));
    else if (tokens[i + 1] === '..' && /^-?\d+$/.test(t) && /^-?\d+$/.test(tokens[i + 2] ?? '')) {
      push(Number(t), Number(tokens[i + 2]));
      i += 2;
    } else out.push(t);
  }
  return out;
}
const PLAIN_NUM = /^\s*-?\d+(\.\d+)?\s*$/;
const isPlainNum = (x) => (typeof x === 'number' ? Number.isFinite(x) : typeof x === 'string' && PLAIN_NUM.test(x));
function beatStep(pat, k, dv) {
  const d = num(dv);
  const kNum = num(k);
  if (!(d > 0) || !Number.isFinite(kNum)) return silence;
  const kk = toFrac(mod(kNum, d));
  const dd = toFrac(d);
  const b = kk.div(dd);
  const e = kk.add(1).div(dd);
  return pat.fmap((x) => pure(x)._compress(b, e)).innerJoin();
}
Pattern.prototype.beat = function (steps, div = 16) {
  const pat = this;
  let layers;
  if (Array.isArray(steps)) layers = steps;
  else if (typeof steps === 'string') {
    layers = expandStepRanges(splitTopLevel(steps));
    // un ".." que no es un rango simple de números: se lee la cadena entera como mini-notación
    if (layers.some((x) => String(x).includes('..'))) layers = [steps];
  } else layers = [steps];
  if (layers.length === 0) return silence;
  // ruta rápida: pasos y div enteros y fijos -> una sola estructura (mismo resultado que la ruta general)
  const dPlain = isPlainArg(div) ? num(div) : NaN;
  if (Number.isInteger(dPlain) && dPlain >= 1 && dPlain <= 4096 && layers.every((x) => isPlainNum(x) && Number.isInteger(Number(x)))) {
    const bits = Array(dPlain).fill(false);
    for (const x of layers) bits[mod(Number(x), dPlain)] = true;
    return pat.struct(fastcat(...bits));
  }
  const divPat = reify(div);
  return stack(
    ...layers.map((layer) =>
      reify(layer)
        .fmap((k) => divPat.fmap((dv) => beatStep(pat, k, dv)).innerJoin())
        .innerJoin(),
    ),
  );
};

// --- más funciones de Strudel ---
register('undegrade', 0, (pat) => pat._undegradeBy(0.5));
Pattern.prototype.inv = function () {
  return this.fmap((x) => !truthy(x));
};
Pattern.prototype.invert = Pattern.prototype.inv;
export const slider = (v) => pure(num(v));
// un patrón distinto por ciclo, elegido al azar con pesos: wchooseCycles(["bd", 3], ["sn", 1]).
// Como en Strudel, los pesos pueden ser patrones: se leen al principio de cada ciclo (["bd(3,8)", "<5 0>"]).
export function wchooseCycles(...pairs) {
  for (const p of pairs) {
    if (!Array.isArray(p) || p.length < 2) throw new Error('wchooseCycles(): cada opción es [patrón, peso], p. ej. ["bd*4", 3]');
  }
  const pats = pairs.map(([p]) => reify(p));
  const weights = pairs.map(([, w]) => reify(w));
  return new Pattern((st) => {
    const c = st.span.begin.sam();
    const ws = weights.map((w) => {
      const h = w.queryArc(c, c)[0];
      const x = h ? num(h.value) : 0;
      return Number.isFinite(x) && x > 0 ? x : 0;
    });
    const total = ws.reduce((a, b) => a + b, 0);
    if (!(total > 0)) return [];
    const r = timeToRand(c.valueOf() + 0.31);
    let acc = 0;
    for (let i = 0; i < pats.length; i++) {
      acc += ws[i] / total;
      if (ws[i] > 0 && r < acc) return pats[i].query(st);
    }
    for (let i = pats.length - 1; i >= 0; i--) if (ws[i] > 0) return pats[i].query(st);
    return [];
  }).splitQueries();
}
export const wrandcat = wchooseCycles;

// Agrupa los eventos simultáneos (mismo whole) en un único evento con una lista de valores
export const pitchOf = (v) => {
  if (typeof v === 'number') return v;
  if (isObj(v)) {
    const x = v.note ?? v.n ?? v.freq;
    return typeof x === 'number' ? x : null;
  }
  return null;
};
Pattern.prototype.collect = function () {
  const pat = this;
  return new Pattern((st) => {
    const groups = new Map();
    for (const h of pat.query(st)) {
      const k = `${h.whole ? `${h.whole.begin}:${h.whole.end}` : '-'}|${h.part.begin}:${h.part.end}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(h);
    }
    // como Strudel: se conserva el orden en que se escribieron (el de la pila)
    return [...groups.values()].map((hs) => new Hap(hs[0].whole, hs[0].part, hs.map((h) => h.value), hs[0].context));
  });
};
// arpWith(lista => patrón): recibe las notas simultáneas y devuelve el patrón que suena
Pattern.prototype.arpWith = function (f) {
  return this.collect()
    .fmap((vs) => reify(f(vs)))
    .innerJoin();
};

// stack/cat/seq también como métodos: s("bd").stack(s("hh*4"))
Pattern.prototype.stack = function (...others) {
  return stack(this, ...others);
};
Pattern.prototype.cat = function (...others) {
  return slowcat(this, ...others);
};
Pattern.prototype.slowcat = Pattern.prototype.cat;
Pattern.prototype.seq = function (...others) {
  return fastcat(this, ...others);
};
Pattern.prototype.fastcat = Pattern.prototype.seq;

// --- euclídeos ---
export function bjorklund(k, n) {
  k = Math.round(k);
  n = Math.round(n);
  if (n <= 0) return [];
  if (k < 0) return bjorklund(-k, n).map((x) => 1 - x);
  if (k === 0) return Array(n).fill(0);
  if (k >= n) return Array(n).fill(1);
  let a = Array.from({ length: k }, () => [1]);
  let b = Array.from({ length: n - k }, () => [0]);
  while (b.length > 1) {
    const m = Math.min(a.length, b.length);
    const merged = [];
    for (let i = 0; i < m; i++) merged.push([...a[i], ...b[i]]);
    const rest = a.length > m ? a.slice(m) : b.slice(m);
    a = merged;
    b = rest;
  }
  return [...a, ...b].flat();
}
// La rotación va hacia la derecha, como en Strudel: "bd(3,8,2)" = x.x..x.. (0, 1/4, 5/8)
export function euclidBools(k, n, rot = 0) {
  const bits = bjorklund(k, n);
  if (bits.length === 0) return [];
  const r = mod(-Math.round(rot), bits.length);
  return [...bits.slice(r), ...bits.slice(0, r)];
}
register('euclid', 3, (pat, k, n, r) => {
  const bits = euclidBools(num(k), num(n), r == null ? 0 : num(r));
  if (bits.length === 0) return silence;
  return pat.struct(fastcat(...bits.map((x) => x === 1)));
});
register('euclidRot', 3, (pat, k, n, r) => pat._euclid(k, n, r));
// Cada nota dura hasta el siguiente pulso, también al dar la vuelta al ciclo (con rotación).
register('euclidLegato', 3, (pat, k, n, r) => {
  const bits = euclidBools(num(k), num(n), r == null ? 0 : num(r));
  const first = bits.indexOf(1);
  if (first < 0) return silence;
  const steps = bits.length;
  const rotated = [...bits.slice(first), ...bits.slice(0, first)];
  const pairs = [];
  let i = 0;
  while (i < steps) {
    let j = i + 1;
    while (j < steps && rotated[j] === 0) j++;
    pairs.push([j - i, pure(true)]);
    i = j;
  }
  return pat.struct(timecat(...pairs)._late(new Fraction(first, steps)));
});
register('euclidLegatoRot', 3, (pat, k, n, r) => pat._euclidLegato(k, n, r));

// --- samples ---
register('chop', 1, (pat, n) => {
  n = Math.max(1, Math.round(num(n)));
  return pat
    .fmap((v) => {
      const o = toObj(v);
      const b = o.begin ?? 0;
      const e = o.end ?? 1;
      const d = e - b;
      return fastcat(...range(n).map((i) => pure({ ...o, begin: b + (d * i) / n, end: b + (d * (i + 1)) / n })));
    })
    .squeezeJoin();
});
register('striate', 1, (pat, n) => {
  n = Math.max(1, Math.round(num(n)));
  return fastcat(...range(n).map((i) => pat.fmap((v) => ({ ...toObj(v), begin: i / n, end: (i + 1) / n }))));
});
register('slice', 1, (pat, n, idx) => {
  n = Math.max(1, Math.round(num(n)));
  return reify(idx)
    .fmap((i) => {
      const k = mod(Math.floor(num(i)), n);
      return pat.fmap((v) => ({ ...toObj(v), begin: k / n, end: (k + 1) / n }));
    })
    .outerJoin();
});
register('splice', 1, (pat, n, idx) => pat._slice(n, idx).fmap((v) => ({ ...v, fit: 1 })));
register('loopAt', 1, (pat, n) => pat._slow(n).fmap((v) => ({ ...toObj(v), fit: 1 })));
Pattern.prototype.fit = function () {
  return this.fmap((v) => ({ ...toObj(v), fit: 1 }));
};

// --- números ---
const MAIN_KEYS = ['note', 'n', 'freq'];
let noteParser = (x) => Number(x);
export function setNoteParser(fn) {
  noteParser = fn;
}
export function toNumber(x) {
  if (typeof x === 'number') return x;
  if (x instanceof Fraction) return x.valueOf();
  if (typeof x === 'boolean') return x ? 1 : 0;
  if (typeof x === 'string') {
    const v = Number(x);
    if (x.trim() !== '' && !Number.isNaN(v)) return v;
    return noteParser(x);
  }
  throw new Error(`No se puede operar con "${x}"`);
}
function numericOp(op) {
  return (a, b) => {
    if (isObj(a) && isObj(b)) {
      const out = { ...a };
      for (const k of Object.keys(b)) {
        if (k in a && typeof a[k] !== 'string' && typeof b[k] !== 'string') out[k] = op(toNumber(a[k]), toNumber(b[k]));
        else if (k in a && MAIN_KEYS.includes(k)) out[k] = op(toNumber(a[k]), toNumber(b[k]));
        else out[k] = b[k];
      }
      return out;
    }
    if (isObj(a)) {
      const key = MAIN_KEYS.find((k) => k in a);
      if (!key) return a;
      return { ...a, [key]: op(toNumber(a[key]), toNumber(b)) };
    }
    if (isObj(b)) {
      const key = MAIN_KEYS.find((k) => k in b);
      if (!key) return b;
      return { ...b, [key]: op(toNumber(a), toNumber(b[key])) };
    }
    return op(toNumber(a), toNumber(b));
  };
}
const ops = {
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  mod: (a, b) => mod(a, b),
  pow: (a, b) => a ** b,
};
for (const [name, op] of Object.entries(ops)) {
  const f = numericOp(op);
  Pattern.prototype[name] = function (other) {
    return this.appLeft(reify(other), f);
  };
}
Pattern.prototype.transpose = Pattern.prototype.add;
const mapMain = (f) => (v) => {
  if (isObj(v)) {
    const key = MAIN_KEYS.find((k) => k in v);
    return key ? { ...v, [key]: f(toNumber(v[key])) } : v;
  }
  return f(toNumber(v));
};
Pattern.prototype.round = function () {
  return this.fmap(mapMain(Math.round));
};
Pattern.prototype.floor = function () {
  return this.fmap(mapMain(Math.floor));
};
Pattern.prototype.ceil = function () {
  return this.fmap(mapMain(Math.ceil));
};
register('range', 2, (pat, lo, hi) => {
  const a = num(lo);
  const b = num(hi);
  return pat.fmap(mapMain((x) => x * (b - a) + a));
});
register('rangex', 2, (pat, lo, hi) => {
  const a = Math.log(num(lo));
  const b = Math.log(num(hi));
  return pat.fmap(mapMain((x) => Math.exp(x * (b - a) + a)));
});
Pattern.prototype.toBipolar = function () {
  return this.fmap(mapMain((x) => x * 2 - 1));
};
Pattern.prototype.fromBipolar = function () {
  return this.fmap(mapMain((x) => (x + 1) / 2));
};
Pattern.prototype.set = function (other) {
  return this.appLeft(reify(other), (a, b) => ({ ...toObj(a), ...toObj(b) }));
};
Pattern.prototype.mute = function () {
  return silence;
};

// Métodos de visualización de Strudel: aquí no hacen nada (compatibilidad al pegar código).
for (const name of ['color', 'pianoroll', 'punchcard', 'scope', 'spectrum', 'spiral', 'log', 'analyze', 'markcss', 'tag']) {
  Pattern.prototype[name] = function () {
    return this;
  };
  Pattern.prototype['_' + name] = Pattern.prototype[name];
}

export const cosine = sine._early(0.25);
export const sine2 = sine.fmap((x) => x * 2 - 1);
export const saw2 = saw.fmap((x) => x * 2 - 1);
export const tri2 = tri.fmap((x) => x * 2 - 1);
export const square2 = square.fmap((x) => x * 2 - 1);

// Versiones funcionales: fast(2, pat), rev(pat)...
export const fast = (f, pat) => reify(pat).fast(f);
export const slow = (f, pat) => reify(pat).slow(f);
export const rev = (pat) => reify(pat).rev();
// s("bd").struct("1 0 0 1".lastOf(4, invert)) como en Strudel
export const invert = (pat) => reify(pat).inv();
export const inv = invert;
export const cat = slowcat;
export const seq = fastcat;
export const sequence = fastcat;
export const timeCat = timecat;
export const stepcat = timecat;
export const pm = polymeter;
