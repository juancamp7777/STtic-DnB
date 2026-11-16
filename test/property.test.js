// Tests de propiedades: cientos de patrones aleatorios deben cumplir invariantes que el
// scheduler necesita (consultas partidas = consulta entera, determinismo, haps bien formados).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/core/index.js';
import { rng } from '../src/gen/generator.js';
import { assertSplitInvariant, assertWellFormed, ev } from './helpers.js';

const { mini, pure, stack, slowcat, fastcat, timecat, arrange, s, n, run } = P;

export function randomMini(r, depth = 0) {
  const atoms = ['a', 'b', 'c', 'bd', 'sn:2', '0', '3', '~'];
  const steps = r.int(1, 4);
  const out = [];
  for (let i = 0; i < steps; i++) {
    let st;
    const k = depth < 2 ? r.int(0, 9) : 0;
    if (k === 7) st = `[${randomMini(r, depth + 1)}]`;
    else if (k === 8) st = `<${randomMini(r, depth + 1)}>`;
    else if (k === 9) st = `{${randomMini(r, depth + 1)}}%${r.int(2, 5)}`;
    else st = r.pick(atoms);
    const mod = r.int(0, 12);
    if (mod === 0) st += `*${r.pick([2, 3, 1.5])}`;
    else if (mod === 1) st += `/${r.pick([2, 3])}`;
    else if (mod === 2) st += `!${r.int(2, 3)}`;
    else if (mod === 3) st += `@${r.int(2, 3)}`;
    else if (mod === 4) st += '?';
    else if (mod === 5) st += `(${r.int(1, 7)},8,${r.int(0, 3)})`;
    else if (mod === 6) st += `*<${r.int(1, 3)} ${r.int(1, 3)}>`;
    out.push(st);
  }
  if (depth < 1 && r.chance(0.2)) return `${out.join(' ')}, ${randomMini(r, depth + 1)}`;
  return out.join(' ');
}

const tag = (pat, desc) => Object.assign(pat.fmap((x) => x), { desc });

export function randomPattern(r, depth = 0) {
  if (depth >= 3 || r.chance(0.28)) {
    const k = r.int(0, 3);
    if (k === 0) {
      const src = randomMini(r);
      return tag(mini(src), `mini("${src}")`);
    }
    if (k === 1) {
      const v = r.int(0, 9);
      return tag(pure(v), `pure(${v})`);
    }
    if (k === 2) {
      const m = r.int(1, 2);
      return tag(s(mini('bd sn hh cp').fast(m)), `s("bd sn hh cp").fast(${m})`);
    }
    const m = r.int(1, 8);
    return tag(n(run(m)), `n(run(${m}))`);
  }
  const kids = [];
  const p = () => {
    const c = randomPattern(r, depth + 1);
    kids.push(c.desc);
    return c;
  };
  const fs = [
    ['rev', (x) => x.rev()],
    ['fast2', (x) => x.fast(2)],
    ['late1/8', (x) => x.late(0.125)],
    ['ply2', (x) => x.ply(2)],
  ];
  let fname = '';
  const f = () => {
    const [nm, fn] = r.pick(fs);
    fname = nm;
    return fn;
  };
  let arg = '';
  const A = (x) => {
    arg += `${typeof x === 'string' ? `"${x}"` : +Number(x).toFixed(4)},`;
    return x;
  };
  const ops = [
    ['fast', () => p().fast(A(r.pick([0.5, 1.5, 2, 3, '<1 2>'])))],
    ['slow', () => p().slow(A(r.pick([2, 1.5, 3, '<1 2>'])))],
    ['rev', () => p().rev()],
    ['ply', () => p().ply(A(r.pick([2, 3, '<1 2>'])))],
    ['every', () => p().every(A(r.int(2, 4)), f())],
    ['lastOf', () => p().lastOf(A(r.int(2, 4)), f())],
    ['off', () => p().off(A(r.pick([0.125, 0.25, 1 / 3])), f())],
    ['euclid', () => p().euclid(A(r.int(1, 7)), 8, A(r.int(0, 3)))],
    ['euclidLegato', () => p().euclidLegato(A(r.int(1, 7)), 8)],
    ['degradeBy', () => p().degradeBy(A(r.float(0, 1)))],
    ['sometimesBy', () => p().sometimesBy(0.5, f())],
    ['someCyclesBy', () => p().someCyclesBy(0.5, f())],
    ['chunk', () => p().chunk(4, f())],
    ['iter', () => p().iter(A(r.int(2, 4)))],
    ['linger', () => p().linger(A(r.pick([0.25, 0.5, '<0.25 0.5>'])))],
    ['stack', () => stack(p(), p())],
    ['slowcat', () => slowcat(p(), p())],
    ['fastcat', () => fastcat(p(), p(), p())],
    ['timecat', () => timecat([A(r.int(1, 3)), p()], [A(r.int(1, 3)), p()])],
    ['struct', () => p().struct(A(r.pick(['x ~ x x', 'x(3,8)', '<x [x x]>'])))],
    ['mask', () => p().mask(A(r.pick(['1 0 1 1', '<1 0>', '1 [0 1]'])))],
    ['chop', () => p().chop(A(r.int(1, 4)))],
    ['striate', () => p().striate(A(r.int(1, 3)))],
    ['early', () => p().early(A(r.pick([0.25, 1 / 3, 1.5])))],
    ['late', () => p().late(A(r.pick([0.25, 1 / 7, 2.5])))],
    ['palindrome', () => p().palindrome()],
    ['swingBy', () => p().swingBy(1 / 3, 4)],
    ['arrange', () => arrange([A(r.int(1, 3)), p()], [A(r.int(1, 3)), p()])],
    ['compress', () => p().compress(0.25, 0.75)],
    ['zoom', () => p().zoom(0.25, 0.75)],
    ['segment', () => p().segment(A(r.int(1, 8)))],
    ['ribbon', () => p().ribbon(A(r.int(0, 3)), A(r.int(1, 4)))],
    ['brak', () => p().brak()],
    ['press', () => p().press()],
    ['inside', () => p().inside(2, (x) => x.rev())],
    ['echo', () => p().echo(3, 0.125, 0.5)],
    ['jux', () => p().jux((x) => x.rev())],
    ['within', () => p().within(0, 0.5, f())],
    ['whenmod', () => p().whenmod(4, 2, f())],
    ['hurry', () => p().hurry(2)],
    ['iterBack', () => p().iterBack(3)],
    ['superimpose', () => p().superimpose(f())],
  ];
  const [name, build] = r.pick(ops);
  const pat = build();
  return tag(pat, `${name}(${arg}${fname}) ← [${kids.join(' ; ')}]`);
}

test('300 patrones aleatorios: consultas partidas = entera, deterministas y bien formados', () => {
  const r = rng(2024);
  let events = 0;
  for (let i = 0; i < 300; i++) {
    const pat = randomPattern(r);
    const label = `patrón #${i}: ${pat.desc}`;
    assertSplitInvariant(pat, 6, r.next, label);
    assertWellFormed(pat, 0, 6, label);
    assertWellFormed(pat, 0.3, 2.7, label);
    const a = ev(pat, 0, 6);
    assert.deepEqual(a, ev(pat, 0, 6), `${label}: no determinista`);
    events += a.length;
  }
  assert.ok(events > 2000, `pocos eventos generados (${events})`);
});

test('patrones aleatorios consultados en tiempos lejanos y negativos', () => {
  const r = rng(77);
  for (let i = 0; i < 80; i++) {
    const pat = randomPattern(r);
    for (const off of [1000, 123456, -5]) assertWellFormed(pat, off, off + 1.5, `#${i} @${off}: ${pat.desc}`);
  }
});

test('argumentos patroneados = argumentos fijos cuando el patrón es constante', () => {
  const r = rng(99);
  for (let i = 0; i < 100; i++) {
    const base = randomPattern(r);
    const k = r.pick([2, 3, 0.5]);
    assert.deepEqual(ev(base.fast(k), 0, 4), ev(base.fast(String(k)), 0, 4), base.desc);
    assert.deepEqual(ev(base.slow(k), 0, 4), ev(base.slow(String(k)), 0, 4), base.desc);
    assert.deepEqual(ev(base.euclid(3, 8), 0, 3), ev(base.euclid('3', '8'), 0, 3), base.desc);
  }
});
