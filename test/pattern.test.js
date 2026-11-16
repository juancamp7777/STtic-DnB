import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/core/index.js';
import { ev, vals } from './helpers.js';

const { mini, pure, silence, fastcat, slowcat, stack, timecat, s, n, note, sine, saw, square, rand, perlin, irand, choose, run, arrange, form, polymeter, bjorklund, euclidBools } = P;
const at = (pat, b = 0, e = 1) => ev(pat, b, e).map((x) => x[0]);
const names = (pat, b = 0, e = 1) => ev(pat, b, e).map((x) => x[2]);

test('pure y silence', () => {
  assert.deepEqual(ev(pure('x'), 0, 3), [['0', '1', 'x'], ['1', '2', 'x'], ['2', '3', 'x']]);
  assert.deepEqual(ev(silence, 0, 10), []);
  const frag = pure('x').queryArc(0.25, 0.75);
  assert.equal(frag.length, 1);
  assert.equal(frag[0].hasOnset(), false);
});

test('fastcat, slowcat, stack, timecat', () => {
  assert.deepEqual(names(fastcat('a', 'b', 'c')), ['a', 'b', 'c']);
  assert.deepEqual(names(slowcat('a', 'b'), 0, 4), ['a', 'b', 'a', 'b']);
  // cada elemento de slowcat ve sus propios ciclos
  assert.deepEqual(names(slowcat(mini('<x y>'), 'b'), 0, 4), ['x', 'b', 'y', 'b']);
  assert.deepEqual(names(stack('a', 'b')).sort(), ['a', 'b']);
  assert.deepEqual(ev(timecat([3, 'a'], [1, 'b'])), [['0', '3/4', 'a'], ['3/4', '1', 'b']]);
  assert.deepEqual(ev(timecat([0, 'a'], [1, 'b'])), [['0', '1', 'b']]);
  assert.deepEqual(names(fastcat()), []);
});

test('fast / slow (también patroneados y casos límite)', () => {
  assert.deepEqual(at(mini('a b').fast(2)), ['0', '1/4', '1/2', '3/4']);
  assert.deepEqual(at(mini('a b').slow(2), 0, 2), ['0', '1']);
  assert.deepEqual(at(mini('a').fast('<1 3>'), 0, 2), ['0', '1', '4/3', '5/3']);
  assert.deepEqual(ev(mini('a').fast(0)), []);
  assert.deepEqual(names(mini('a b c').fast(-1)), ['c', 'b', 'a']);
  assert.deepEqual(ev(mini('a').slow(0)), []);
});

test('early / late cruzan ciclos', () => {
  assert.deepEqual(ev(mini('a b').late(0.25)), [['1/4', '3/4', 'a'], ['3/4', '5/4', 'b']]);
  assert.deepEqual(ev(mini('a b').early(0.25)), [['1/4', '3/4', 'b'], ['3/4', '5/4', 'a']]);
  assert.deepEqual(ev(mini('a b').late('<0 0.5>'), 1, 2), [['1', '3/2', 'b'], ['3/2', '2', 'a']]);
});

test('rev, palindrome, iter', () => {
  assert.deepEqual(names(mini('a b c d').rev()), ['d', 'c', 'b', 'a']);
  assert.deepEqual(names(mini('[a b] c').rev()), ['c', 'b', 'a']);
  assert.deepEqual(names(mini('a b c').palindrome(), 0, 2), ['a', 'b', 'c', 'c', 'b', 'a']);
  assert.deepEqual(names(mini('a b c d').iter(4), 1, 2), ['b', 'c', 'd', 'a']);
  assert.deepEqual(names(mini('a b c d').iterBack(4), 1, 2), ['d', 'a', 'b', 'c']);
});

test('ply, segment, range, rangex', () => {
  assert.deepEqual(names(mini('a b').ply(2)), ['a', 'a', 'b', 'b']);
  assert.deepEqual(names(mini('a b').ply('<2 3>'), 1, 2), ['a', 'a', 'a', 'b', 'b', 'b']);
  assert.deepEqual(vals(saw.segment(4)), [0, 0.25, 0.5, 0.75]);
  assert.deepEqual(vals(saw.segment(4).range(100, 200)), [100, 125, 150, 175]);
  const ex = vals(saw.segment(2).rangex(100, 400));
  assert.ok(Math.abs(ex[0] - 100) < 1e-9 && Math.abs(ex[1] - 200) < 1e-9);
});

test('every / firstOf / lastOf / whenmod / when', () => {
  const p = mini('a b');
  const f = (x) => x.fast(2);
  assert.equal(ev(p.every(3, f), 0, 1).length, 4);
  assert.equal(ev(p.every(3, f), 1, 2).length, 2);
  assert.equal(ev(p.every(3, f), 3, 4).length, 4);
  assert.equal(ev(p.lastOf(3, f), 2, 3).length, 4);
  assert.equal(ev(p.lastOf(3, f), 0, 1).length, 2);
  assert.equal(ev(p.whenmod(4, 2, f), 1, 2).length, 2);
  assert.equal(ev(p.whenmod(4, 2, f), 2, 3).length, 4);
  assert.equal(ev(p.whenmod(4, 2, f), 3, 4).length, 4);
  assert.equal(ev(p.when('<0 1>', f), 0, 1).length, 2);
  assert.equal(ev(p.when('<0 1>', f), 1, 2).length, 4);
  assert.equal(ev(p.every('<2 3>', f), 0, 1).length, 4);
});

test('degradeBy / sometimesBy: deterministas y particionan', () => {
  const p = mini('x*16');
  const a = ev(p.degradeBy(0.5), 0, 32);
  assert.deepEqual(a, ev(p.degradeBy(0.5), 0, 32));
  const ratio = a.length / (16 * 32);
  assert.ok(ratio > 0.4 && ratio < 0.6, `ratio ${ratio}`);
  assert.equal(ev(p.degradeBy(0), 0, 4).length, 64);
  assert.equal(ev(p.degradeBy(1), 0, 4).length, 0);
  // sometimesBy conserva el total y aplica f a una fracción
  const marked = p.sometimesBy(0.3, (x) => x.fmap((v) => v + '!'));
  const all = names(marked, 0, 32);
  assert.equal(all.length, 16 * 32);
  const frac = all.filter((v) => v.endsWith('!')).length / all.length;
  assert.ok(frac > 0.2 && frac < 0.4, `frac ${frac}`);
  // como Strudel: degradeBy(x) y undegradeBy(1 - x) se reparten los golpes (undegradeBy(x) deja pasar 1 - x)
  const deg = ev(p.degradeBy(0.3), 0, 8).length + ev(p.undegradeBy(0.7), 0, 8).length;
  assert.equal(deg, 128);
  const kept = ev(p.undegradeBy(0.2), 0, 32).length / (16 * 32);
  assert.ok(kept > 0.7 && kept < 0.9, `undegradeBy(.2) deja ~80 % (${kept})`);
  const cyc = mini('x').someCyclesBy(0.5, (x) => x.fast(2));
  const counts = Array.from({ length: 100 }, (_, c) => ev(cyc, c, c + 1).length);
  assert.ok(counts.includes(1) && counts.includes(2));
});

test('bjorklund coincide con los ritmos conocidos (Toussaint)', () => {
  const str = (k, nn) => bjorklund(k, nn).map((b) => (b ? 'x' : '.')).join('');
  assert.equal(str(3, 8), 'x..x..x.');
  assert.equal(str(5, 8), 'x.xx.xx.');
  assert.equal(str(2, 5), 'x.x..');
  assert.equal(str(3, 4), 'xxx.');
  assert.equal(str(3, 5), 'x.x.x');
  assert.equal(str(4, 7), 'x.x.x.x');
  assert.equal(str(5, 9), 'x.x.x.x.x');
  assert.equal(str(7, 16), 'x..x.x.x..x.x.x.');
  assert.equal(str(5, 16), 'x..x..x..x..x...');
  assert.equal(str(9, 16), 'x.xx.x.x.xx.x.x.');
  assert.equal(str(0, 4), '....');
  assert.equal(str(4, 4), 'xxxx');
  assert.equal(str(-3, 8), '.xx.xx.x');
  // rotación como Strudel (hacia la derecha)
  assert.deepEqual(euclidBools(3, 8, 2), [1, 0, 1, 0, 0, 1, 0, 0]);
  assert.deepEqual(euclidBools(3, 8, -1), [0, 0, 1, 0, 0, 1, 0, 1]);
  for (let nn = 1; nn <= 32; nn++) {
    for (let k = 0; k <= nn; k++) {
      const b = bjorklund(k, nn);
      assert.equal(b.length, nn);
      assert.equal(b.filter(Boolean).length, k);
      if (k > 0) assert.equal(b[0], 1);
    }
  }
});

test('euclid y euclidLegato', () => {
  assert.deepEqual(at(s('bd').euclid(3, 8)), ['0', '3/8', '3/4']);
  assert.deepEqual(ev(s('bd').euclidLegato(3, 8)).map((x) => x[1]), ['3/8', '3/4', '1']);
  assert.deepEqual(at(s('bd').euclid('<3 5>', 8), 1, 2).length, 5);
});

test('struct y mask', () => {
  assert.deepEqual(at(s('bd').struct('x ~ x x')), ['0', '1/2', '3/4']);
  assert.deepEqual(at(s('bd').struct('1 0 1 true')), ['0', '1/2', '3/4']);
  assert.deepEqual(names(mini('a b c d').mask('1 0 1 1')), ['a', 'c', 'd']);
  assert.deepEqual(names(mini('a b').mask('<1 0>'), 0, 2), ['a', 'b']);
  // struct toma valores del patrón fuente
  assert.deepEqual(names(mini('a b c d').struct('x ~ ~ x')), ['a', 'd']);
});

test('off, superimpose, layer, jux, echo', () => {
  assert.deepEqual(at(mini('a').off(0.25, (x) => x)), ['0', '1/4']);
  assert.equal(ev(mini('a b').superimpose((x) => x.fast(2))).length, 6);
  assert.equal(ev(mini('a').layer((x) => x, (x) => x.fast(2))).length, 3);
  const j = vals(s('bd').jux((x) => x));
  assert.deepEqual(j.map((v) => v.pan).sort(), [0, 1]);
  const e = vals(s('bd').echo(3, 0.125, 0.5));
  assert.deepEqual(e.map((v) => v.gain ?? 1), [1, 0.5, 0.25]);
});

test('chunk, within, linger, zoom, compress, ribbon, brak, press', () => {
  const p = mini('a b c d');
  const up = (x) => x.fmap((v) => v.toUpperCase());
  assert.deepEqual(names(p.chunk(4, up), 0, 1), ['A', 'b', 'c', 'd']);
  assert.deepEqual(names(p.chunk(4, up), 1, 2), ['a', 'B', 'c', 'd']);
  assert.deepEqual(names(p.within(0, 0.5, up)), ['A', 'B', 'c', 'd']);
  assert.deepEqual(names(p.linger(0.25)), ['a', 'a', 'a', 'a']);
  assert.deepEqual(names(p.linger(0.5)), ['a', 'b', 'a', 'b']);
  assert.deepEqual(ev(p.zoom(0.25, 0.75)), [['0', '1/2', 'b'], ['1/2', '1', 'c']]);
  assert.deepEqual(ev(mini('a b').compress(0.5, 1)), [['1/2', '3/4', 'a'], ['3/4', '1', 'b']]);
  assert.deepEqual(ev(mini('a').compress(0.75, 0.5)), []);
  assert.deepEqual(names(mini('<a b c d>').ribbon(1, 2), 0, 4), ['b', 'c', 'b', 'c']);
  assert.deepEqual(at(mini('a b').brak(), 1, 2), ['5/4', '3/2']);
  assert.deepEqual(ev(mini('a b').press()), [['1/4', '1/2', 'a'], ['3/4', '1', 'b']]);
});

test('swingBy retrasa las semicorcheas impares', () => {
  const t = at(mini('x*8').swingBy(1 / 3, 4));
  // el retraso es x/n de ciclo: (1/3)/4 = 1/12
  assert.deepEqual(t, ['0', '5/24', '1/4', '11/24', '1/2', '17/24', '3/4', '23/24']);
});

test('hurry, chop, striate, slice, splice, loopAt, fit', () => {
  const h = vals(s('bd sn').hurry(2));
  assert.equal(h.length, 4);
  assert.ok(h.every((v) => v.speed === 2));
  assert.deepEqual(vals(s('brk').chop(4)).map((v) => [v.begin, v.end]), [[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 1]]);
  assert.deepEqual(vals(s('brk').begin(0.5).chop(2)).map((v) => [v.begin, v.end]), [[0.5, 0.75], [0.75, 1]]);
  assert.deepEqual(vals(s('brk').striate(2)).map((v) => v.begin), [0, 0.5]);
  const sl = ev(s('brk').slice(4, '0 2 1 3'));
  assert.deepEqual(sl.map((x) => x[0]), ['0', '1/4', '1/2', '3/4']);
  assert.deepEqual(vals(s('brk').slice(4, '0 2 1 3')).map((v) => v.begin), [0, 0.5, 0.25, 0.75]);
  assert.deepEqual(vals(s('brk').slice(4, '5 -1')).map((v) => v.begin), [0.25, 0.75]);
  assert.ok(vals(s('brk').splice(8, '0 1')).every((v) => v.fit === 1));
  const la = ev(s('brk').loopAt(2), 0, 2);
  assert.deepEqual(la, [['0', '2', 'fit=1,s=brk']]);
  assert.ok(vals(s('brk').fit()).every((v) => v.fit === 1));
});

test('aritmética: números, objetos y nombres de nota', () => {
  assert.deepEqual(vals(mini('1 2').add(10)), [11, 12]);
  assert.deepEqual(vals(mini('c3 e3').add(0)), [48, 52]);
  assert.deepEqual(vals(note('c3').add(note(12))).map((v) => v.note), [60]);
  assert.deepEqual(vals(n('0 2').add('<0 7>'), 1, 2).map((v) => v.n), [7, 9]);
  assert.deepEqual(vals(note('60').sub(12)).map((v) => v.note), [48]);
  assert.deepEqual(vals(mini('2 3').mul(2)), [4, 6]);
  assert.deepEqual(vals(mini('9').div(3)), [3]);
  assert.deepEqual(vals(mini('7').mod(3)), [1]);
  assert.deepEqual(vals(mini('1.6').round()), [2]);
  assert.deepEqual(vals(s('bd').add(1)), [{ s: 'bd' }], 'sin clave numérica no cambia');
  assert.throws(() => mini('bd').add(1).queryArc(0, 1), /Nota inválida/);
});

test('señales', () => {
  const v = (sig, t) => sig.queryArc(t, t)[0].value;
  assert.equal(v(sine, 0), 0.5);
  assert.ok(Math.abs(v(sine, 0.25) - 1) < 1e-12);
  assert.ok(Math.abs(v(P.cosine, 0) - 1) < 1e-12);
  assert.equal(v(saw, 0.5), 0.5);
  assert.equal(v(square, 0.25), 0);
  assert.equal(v(square, 0.75), 1);
  assert.equal(v(P.tri, 0.5), 1);
  assert.equal(v(P.isaw, 0.25), 0.75);
  for (let i = 0; i < 500; i++) {
    const t = i * 0.37;
    const r = v(rand, t);
    assert.ok(r >= 0 && r < 1);
    assert.equal(r, v(rand, t), 'rand determinista');
    const pr = v(perlin, t);
    assert.ok(pr >= 0 && pr <= 1);
    const ir = v(irand(8), t);
    assert.ok(Number.isInteger(ir) && ir >= 0 && ir < 8);
  }
  // perlin es continuo
  for (let i = 0; i < 200; i++) assert.ok(Math.abs(v(perlin, i / 100) - v(perlin, i / 100 + 0.001)) < 0.01);
  const ch = vals(s(choose('bd', 'sn', 'hh')).segment(16), 0, 16).map((x) => x.s);
  assert.deepEqual([...new Set(ch)].sort(), ['bd', 'hh', 'sn']);
  // signals lentos/rápidos
  assert.equal(v(saw.slow(4), 2), 0.5);
  assert.equal(v(saw.fast(2), 0.25), 0.5);
});

test('run y polymeter', () => {
  assert.deepEqual(vals(run(4)), [0, 1, 2, 3]);
  assert.deepEqual(vals(run('<2 3>'), 1, 2), [0, 1, 2]);
  assert.deepEqual(names(polymeter(['a', 'b', 'c'], ['d', 'e']), 0, 1).sort(), ['a', 'b', 'c', 'd', 'e', 'd'].sort());
});

test('arrange: cada sección empieza en su ciclo 0 y el arreglo se repite', () => {
  const a = arrange([2, mini('<a b c>')], [1, 'x']);
  assert.deepEqual(names(a, 0, 6), ['a', 'b', 'x', 'a', 'b', 'x']);
  const lens = arrange([0.5, 'p'], [0, 'q'], [1, 'r']);
  assert.ok(ev(lens, 0, 2).length > 0);
});

test('form: secciones con nombre, F.at, errores', () => {
  const F = form('intro:2 drop:4 break:2 drop2:4');
  assert.equal(F.cycles, 12);
  assert.deepEqual(F.at(0), { name: 'intro', index: 0, bar: 0, pos: 0, length: 2 });
  assert.deepEqual(F.at(7), { name: 'break', index: 2, bar: 1, pos: 1, length: 2 });
  assert.equal(F.at(6.5).pos, 0.5);
  assert.equal(F.at(12).name, 'intro');
  assert.equal(F.startOf('drop2'), 8);
  const p = F({ 'drop drop2': mini('<a b c d>'), break: 'x' });
  assert.deepEqual(names(p, 0, 12), ['a', 'b', 'c', 'd', 'x', 'x', 'a', 'b', 'c', 'd']);
  assert.throws(() => F({ chorus: 'x' }), /no existe/);
  assert.throws(() => form('intro:0'), /inválida/);
  assert.throws(() => form(''), /inválida|al menos/);
  assert.equal(form([['a', 3], ['b', 1]]).cycles, 4);
});

test('compatibilidad: métodos visuales de Strudel no hacen nada', () => {
  const p = s('bd sn');
  for (const m of ['color', 'pianoroll', 'punchcard', 'scope', 'spectrum', 'log']) assert.deepEqual(ev(p[m]('x')), ev(p));
});
