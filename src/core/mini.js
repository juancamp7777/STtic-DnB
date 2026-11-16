// Mini-notación compatible con Strudel/Tidal:
//   "bd sn"  "[bd bd] sn"  "<a b c>"  "bd*2"  "bd/2"  "bd!3"  "bd@3"  "bd?"  "bd?0.3"
//   "bd(3,8)"  "bd(3,8,2)"  "a, b" (capas)  "a | b" (azar por ciclo)  "{a b c}%4"
//   "a _ _ b" (alargar)  "a . b c" (grupos)  "~" o "-" (silencio)  "bd:3" (variante)
import {
  pure,
  silence,
  fastcat,
  slowcat,
  timecat,
  stack,
  randcatSeeded,
  setStringParser,
  setStepCounter,
  reify,
  num,
} from './pattern.js';

export class MiniError extends Error {
  constructor(msg, pos, src) {
    super(`Mini-notación: ${msg} (columna ${pos + 1}) en "${src}"`);
    this.name = 'MiniError';
    this.pos = pos;
    this.src = src;
  }
}

// ':' es un operador (como en Strudel): "bd:3", "hh:<0 3>", "1000:<0 10>" unen valores con ':'
const SINGLE = new Set(['[', ']', '<', '>', '{', '}', '(', ')', ',', '|', '*', '/', '!', '@', '?', '%', '~', ':']);
const NUMBER_RE = /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/;
// cualquier espacio Unicode (incluido el espacio duro U+00A0 que traen las webs y los chats)
const isWs = (c) => /\s/.test(c);
const isNumberText = (t) => NUMBER_RE.test(t);

export function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (isWs(c)) {
      i++;
      continue;
    }
    const ws = i === 0 || isWs(src[i - 1]);
    if (SINGLE.has(c)) {
      toks.push({ type: c, pos: i, ws });
      i++;
      continue;
    }
    let j = i;
    while (j < src.length && !isWs(src[j]) && !SINGLE.has(src[j])) j++;
    toks.push({ type: 'word', text: src.slice(i, j), pos: i, ws });
    i = j;
  }
  return toks;
}

const CLOSERS = new Set([']', '>', '}', ')']);

class Parser {
  constructor(src) {
    this.src = src;
    this.toks = tokenize(src);
    this.i = 0;
    this.seed = 0;
  }
  peek() {
    return this.toks[this.i];
  }
  next() {
    return this.toks[this.i++];
  }
  err(msg, tok) {
    return new MiniError(msg, tok ? tok.pos : this.src.length, this.src);
  }
  expect(type) {
    const t = this.next();
    if (!t || t.type !== type) throw this.err(`se esperaba "${type}"`, t);
    return t;
  }
  parse() {
    const node = this.parseStack(null);
    const t = this.peek();
    if (t) throw this.err(`"${t.text ?? t.type}" inesperado`, t);
    return node;
  }
  parseStack(close) {
    const seqs = [this.parseSeq(close)];
    let mode = null;
    while (this.peek() && (this.peek().type === ',' || this.peek().type === '|')) {
      const t = this.next();
      if (mode && mode !== t.type) throw this.err('no se pueden mezclar "," y "|" en el mismo grupo', t);
      mode = t.type;
      seqs.push(this.parseSeq(close));
    }
    if (seqs.length === 1) return seqs[0];
    return mode === ',' ? { type: 'stack', items: seqs } : { type: 'rand', items: seqs, seed: this.seed++ };
  }
  parseSeq(close) {
    const groups = [[]];
    let steps = groups[0];
    for (;;) {
      const t = this.peek();
      if (!t) {
        if (close) throw this.err(`falta cerrar con "${close}"`, null);
        break;
      }
      if (t.type === ',' || t.type === '|') break;
      if (t.type === close) break;
      if (CLOSERS.has(t.type)) throw this.err(`"${t.type}" sin abrir`, t);
      if (t.type === 'word' && t.text === '.') {
        this.next();
        if (steps.length === 0) throw this.err('"." sin pasos antes', t);
        steps = [];
        groups.push(steps);
        continue;
      }
      if (t.type === 'word' && t.text === '_') {
        this.next();
        if (steps.length === 0) throw this.err('"_" sin paso previo', t);
        steps[steps.length - 1].weight += 1;
        continue;
      }
      if (t.type === 'word' && t.text === '..') {
        // rango numérico: "0 .. 3 8" = "[0 1 2 3] 8" (el rango ocupa un único paso, como en Tidal/Strudel)
        this.next();
        const prev = steps[steps.length - 1];
        const nt = this.next();
        if (!prev || prev.node.type !== 'atom' || typeof prev.node.value !== 'number' || prev.reps !== 1 || prev.weight !== 1 || !nt || nt.type !== 'word' || !isNumberText(nt.text)) {
          throw this.err('".." necesita un número a cada lado, p. ej. "0 .. 7"', t);
        }
        const a = prev.node.value;
        const b = Number(nt.text);
        if (!Number.isInteger(a) || !Number.isInteger(b)) throw this.err('".." sólo admite enteros', t);
        if (Math.abs(b - a) > 1024) throw this.err('rango ".." demasiado grande (máx. 1024)', t);
        steps.pop();
        const dir = a <= b ? 1 : -1;
        const inner = [];
        for (let v = a; dir > 0 ? v <= b : v >= b; v += dir) inner.push({ node: { type: 'atom', value: v }, weight: 1, reps: 1 });
        const rangeStep = { node: { type: 'seq', groups: [inner] }, weight: 1, reps: 1 };
        // permite modificadores tras el rango: "0 .. 3*2" afecta al rango entero
        steps.push(this.parseModifiers(rangeStep));
        continue;
      }
      steps.push(this.parseStep());
    }
    if (groups.length > 1 && steps.length === 0) throw this.err('"." sin pasos después', this.peek());
    return { type: 'seq', groups };
  }
  numberArg() {
    const n = this.peek();
    if (n && n.type === 'word' && !n.ws && isNumberText(n.text)) {
      this.next();
      return Number(n.text);
    }
    return null;
  }
  parseStep() {
    return this.parseModifiers({ node: this.parseAtom(), weight: 1, reps: 1 });
  }
  parseModifiers(step) {
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.type === ':') {
        this.next();
        const nx = this.peek();
        const empty = !nx || nx.ws || nx.type === ':' || nx.type === ',' || nx.type === '|' || CLOSERS.has(nx.type);
        step.node = { type: 'tail', node: step.node, arg: empty ? { type: 'atom', value: '' } : this.parseAtom() };
        continue;
      }
      if (t.type === '*' || t.type === '/') {
        this.next();
        const arg = this.parseAtom();
        step.node = { type: t.type === '*' ? 'fast' : 'slow', node: step.node, arg };
        continue;
      }
      if (t.type === '?') {
        this.next();
        const amount = this.numberArg();
        step.node = { type: 'degrade', node: step.node, amount: amount ?? 0.5, seed: this.seed++ };
        continue;
      }
      if (t.type === '!') {
        this.next();
        const n = this.numberArg();
        if (n !== null) {
          if (n < 1 || !Number.isInteger(n)) throw this.err('"!" necesita un entero >= 1', t);
          step.reps = n;
        } else step.reps += 1;
        continue;
      }
      if (t.type === '@') {
        this.next();
        const n = this.next();
        if (!n || n.type !== 'word' || !isNumberText(n.text)) throw this.err('"@" necesita un número', n || t);
        const w = Number(n.text);
        if (w <= 0) throw this.err('"@" necesita un número > 0', n);
        step.weight = w;
        continue;
      }
      if (t.type === '(') {
        this.next();
        const args = [this.parseSeq(')')];
        while (this.peek() && this.peek().type === ',') {
          this.next();
          args.push(this.parseSeq(')'));
        }
        this.expect(')');
        if (args.length < 2 || args.length > 3) throw this.err('euclídeo necesita (pulsos,pasos[,rotación])', t);
        step.node = { type: 'euclid', node: step.node, args };
        continue;
      }
      break;
    }
    return step;
  }
  parseAtom() {
    const t = this.next();
    if (!t) throw this.err('se esperaba un valor', null);
    switch (t.type) {
      case '[': {
        const n = this.parseStack(']');
        this.expect(']');
        return n;
      }
      case '<': {
        const n = this.parseStack('>');
        this.expect('>');
        return { type: 'alt', node: n };
      }
      case '{': {
        const n = this.parseStack('}');
        if (n.type === 'rand') throw this.err('"|" no está permitido dentro de { }', t);
        this.expect('}');
        let steps = null;
        if (this.peek() && this.peek().type === '%') {
          this.next();
          steps = this.parseAtom();
        }
        return { type: 'poly', node: n, steps };
      }
      case '~':
        return { type: 'rest' };
      case ':':
        // campo vacío al principio (":3"): el ':' lo procesa parseModifiers
        this.i--;
        return { type: 'atom', value: '' };
      case 'word':
        if (t.text === '-') return { type: 'rest' };
        if (t.text === '.' || t.text === '_') throw this.err(`"${t.text}" inesperado`, t);
        return { type: 'atom', value: isNumberText(t.text) ? Number(t.text) : t.text };
      default:
        throw this.err(`"${t.type}" inesperado`, t);
    }
  }
}

// --- AST -> Pattern ---
const numericAtom = (node) =>
  node.type === 'atom' && typeof node.value === 'number'
    ? node.value
    : node.type === 'seq' && node.groups.length === 1 && node.groups[0].length === 1 && node.groups[0][0].reps === 1
      ? numericAtom(node.groups[0][0].node)
      : null;

function expand(steps) {
  const out = [];
  for (const s of steps) for (let r = 0; r < s.reps; r++) out.push(s);
  return out;
}

function buildSteps(steps) {
  const ex = expand(steps);
  if (ex.length === 0) return silence;
  if (ex.every((s) => s.weight === 1)) return fastcat(...ex.map((s) => build(s.node)));
  return timecat(...ex.map((s) => [s.weight, build(s.node)]));
}

function buildSeq(node) {
  if (node.groups.length === 1) return buildSteps(node.groups[0]);
  return fastcat(...node.groups.map(buildSteps));
}

function buildAlt(node) {
  if (node.type === 'stack') return stack(...node.items.map(buildAlt));
  if (node.type === 'rand') return randcatSeeded(node.items.map(buildAlt), node.seed);
  if (node.type === 'seq') {
    if (node.groups.length > 1) return slowcat(...node.groups.map(buildSteps));
    const ex = expand(node.groups[0]);
    if (ex.length === 0) return silence;
    // sin pesos: un paso por ciclo
    if (ex.every((s) => s.weight === 1)) return slowcat(...ex.map((s) => build(s.node)));
    // con pesos (@ o _): el paso se ALARGA (un solo evento de varios ciclos), como "<a@3 b>" en Strudel
    const total = ex.reduce((a, s) => a + s.weight, 0);
    return timecat(...ex.map((s) => [s.weight, build(s.node)]))._slow(total);
  }
  return build(node);
}

function stepCount(seqNode) {
  return seqNode.groups.length > 1
    ? seqNode.groups.length
    : expand(seqNode.groups[0]).reduce((a, s) => a + s.weight, 0);
}

function buildPoly(polyNode) {
  const inner = polyNode.node;
  if (inner.type === 'rand') throw new Error('Mini-notación: "|" no está permitido dentro de { }');
  const items = inner.type === 'stack' ? inner.items : [inner];
  const seqs = items.filter((it) => it.type === 'seq' && stepCount(it) > 0);
  if (seqs.length === 0) return silence;
  const baseNum = polyNode.steps ? numericAtom(polyNode.steps) : stepCount(seqs[0]);
  return stack(
    ...seqs.map((it) => {
      const k = stepCount(it);
      const p = buildSeq(it);
      if (baseNum !== null) return p._fast(baseNum / k);
      return p.fast(build(polyNode.steps).fmap((b) => num(b) / k));
    }),
  );
}

function build(node) {
  switch (node.type) {
    case 'atom':
      return pure(node.value);
    case 'rest':
      return silence;
    case 'seq':
      return buildSeq(node);
    case 'stack':
      return stack(...node.items.map(build));
    case 'rand':
      return randcatSeeded(node.items.map(build), node.seed);
    case 'alt':
      return buildAlt(node.node);
    case 'poly':
      return buildPoly(node);
    case 'fast':
    case 'slow': {
      const p = build(node.node);
      const n = numericAtom(node.arg);
      const method = node.type;
      return n !== null ? p['_' + method](n) : p[method](build(node.arg));
    }
    case 'degrade':
      return build(node.node)._degradeBy(node.amount, node.seed);
    case 'tail': {
      // valores unidos con ':' (la estructura viene de la izquierda)
      if (node.node.type === 'atom' && node.arg.type === 'atom') return pure(`${node.node.value}:${node.arg.value}`);
      return build(node.node).appLeft(build(node.arg), (a, b) => `${a}:${b}`);
    }
    case 'euclid': {
      const p = build(node.node);
      const nums = node.args.map(numericAtom);
      if (nums.every((x) => x !== null)) return p._euclid(...nums);
      return p.euclid(...node.args.map(build));
    }
    default:
      throw new Error(`Nodo desconocido ${node.type}`);
  }
}

export function parseMini(src) {
  return new Parser(src).parse();
}

const cache = new Map();
export function mini(src) {
  if (typeof src !== 'string') return reify(src);
  let p = cache.get(src);
  if (!p) {
    p = build(parseMini(src));
    if (cache.size > 5000) cache.clear();
    cache.set(src, p);
  }
  return p;
}
export const m = mini;

// Número de pasos de nivel superior de una cadena de mini-notación (para polymeter("c eb g", ...)).
export function miniStepCount(src) {
  const node = parseMini(src);
  if (node.type === 'seq') return stepCount(node) || null;
  if (node.type === 'stack' || node.type === 'rand') {
    const first = node.items.find((it) => it.type === 'seq');
    return first ? stepCount(first) || null : null;
  }
  return 1;
}
setStepCounter(miniStepCount);

setStringParser(mini);
