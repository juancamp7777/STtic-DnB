import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mini, MiniError, tokenize } from '../src/core/index.js';
import { ev, vals, assertSplitInvariant, assertWellFormed } from './helpers.js';

const E = (src, b = 0, e = 1) => ev(mini(src), b, e);

test('secuencia básica y silencios', () => {
  assert.deepEqual(E('bd sn'), [['0', '1/2', 'bd'], ['1/2', '1', 'sn']]);
  assert.deepEqual(E('bd ~ sn'), [['0', '1/3', 'bd'], ['2/3', '1', 'sn']]);
  assert.deepEqual(E('bd - sn'), [['0', '1/3', 'bd'], ['2/3', '1', 'sn']]);
  assert.deepEqual(E('   bd    sn   '), E('bd sn'));
  assert.deepEqual(E(''), []);
  assert.deepEqual(E('~'), []);
});

test('números, nombres de nota y variantes', () => {
  assert.deepEqual(vals(mini('0 1.5 -2 .25')), [0, 1.5, -2, 0.25]);
  assert.deepEqual(vals(mini('c#3 eb2 bd:3 Bb^7 Dm9')), ['c#3', 'eb2', 'bd:3', 'Bb^7', 'Dm9']);
});

test('subdivisiones y multiplicación', () => {
  assert.deepEqual(E('[bd bd] sn'), [['0', '1/4', 'bd'], ['1/4', '1/2', 'bd'], ['1/2', '1', 'sn']]);
  assert.deepEqual(E('bd*2 sn'), E('[bd bd] sn'));
  assert.deepEqual(E('hh*4').length, 4);
  assert.deepEqual(E('a*1.5', 0, 2).map((x) => x[0]), ['0', '2/3', '4/3']);
  assert.deepEqual(E('[a [b c]]'), [['0', '1/2', 'a'], ['1/2', '3/4', 'b'], ['3/4', '1', 'c']]);
});

test('alternancia < >', () => {
  assert.deepEqual(E('<a b c>', 0, 3), [['0', '1', 'a'], ['1', '2', 'b'], ['2', '3', 'c']]);
  assert.deepEqual(E('<a b c>', 3, 4), [['3', '4', 'a']]);
  assert.deepEqual(E('<a b>*2'), [['0', '1/2', 'a'], ['1/2', '1', 'b']]);
  assert.deepEqual(E('<a [b c]>', 1, 2), [['1', '3/2', 'b'], ['3/2', '2', 'c']]);
  assert.deepEqual(E('[<a b> c]', 0, 2), [['0', '1/2', 'a'], ['1/2', '1', 'c'], ['1', '3/2', 'b'], ['3/2', '2', 'c']]);
  // como Strudel: el peso ALARGA el paso (un único evento de 3 ciclos)
  assert.deepEqual(E('<a@3 b>', 0, 4), [['0', '3', 'a'], ['3', '4', 'b']]);
  assert.deepEqual(E('<a _ b>', 0, 3), [['0', '2', 'a'], ['2', '3', 'b']]);
  assert.deepEqual(E('<a@1.5 b>', 0, 5), [['0', '3/2', 'a'], ['3/2', '5/2', 'b'], ['5/2', '4', 'a'], ['4', '5', 'b']]);
  assert.deepEqual(E('<a!2 b>', 0, 3).map((x) => x[2]), ['a', 'a', 'b']);
  assert.deepEqual(E('<a b, c d e>', 0, 2).map((x) => x[2]).sort(), ['a', 'b', 'c', 'd']);
});

test('división / : eventos largos', () => {
  assert.deepEqual(E('a/2', 0, 2), [['0', '2', 'a']]);
  const frag = mini('a/2').queryArc(1, 2);
  assert.equal(frag.length, 1);
  assert.equal(frag[0].hasOnset(), false);
});

test('replicar !, pesos @ y alargar _', () => {
  assert.deepEqual(E('a!3 b').map((x) => x[2]), ['a', 'a', 'a', 'b']);
  assert.deepEqual(E('a ! b').map((x) => x[2]), ['a', 'a', 'b']);
  assert.deepEqual(E('a!'), E('a a'));
  assert.deepEqual(E('a@3 b'), [['0', '3/4', 'a'], ['3/4', '1', 'b']]);
  assert.deepEqual(E('a _ _ b'), E('a@3 b'));
  assert.deepEqual(E('a@1.5 b'), [['0', '3/5', 'a'], ['3/5', '1', 'b']]);
});

test('grupos con punto', () => {
  assert.deepEqual(E('a . b c'), [['0', '1/2', 'a'], ['1/2', '3/4', 'b'], ['3/4', '1', 'c']]);
  assert.deepEqual(E('a . b c . d'), E('a [b c] d'));
});

test('capas con coma', () => {
  assert.deepEqual(E('[a, b c]').sort(), [['0', '1', 'a'], ['0', '1/2', 'b'], ['1/2', '1', 'c']].sort());
  assert.deepEqual(E('a, b').length, 2);
});

test('euclídeos con rotación y argumentos patroneados', () => {
  const pos = (s, b = 0, e = 1) => E(s, b, e).map((x) => x[0]);
  assert.deepEqual(pos('bd(3,8)'), ['0', '3/8', '3/4']);
  // rotación hacia la derecha, como Strudel
  assert.deepEqual(pos('bd(3,8,2)'), ['0', '1/4', '5/8']);
  assert.deepEqual(pos('bd(<3 5>,8)', 1, 2), ['1', '5/4', '11/8', '13/8', '7/4']);
  assert.deepEqual(pos('bd(0,8)'), []);
  assert.deepEqual(pos('bd(8,8)').length, 8);
  assert.deepEqual(pos('[bd sn](3,8)').length, 3);
});

test('aleatorio ? y | es determinista y aproximadamente justo', () => {
  const a = E('hh*16?', 0, 64);
  const b = E('hh*16?', 0, 64);
  assert.deepEqual(a, b);
  const ratio = a.length / (16 * 64);
  assert.ok(ratio > 0.4 && ratio < 0.6, `ratio ${ratio}`);
  const r9 = E('hh*16?0.9', 0, 64).length / (16 * 64);
  assert.ok(r9 < 0.2, `ratio ${r9}`);
  const choice = E('a | b | c', 0, 300).map((x) => x[2]);
  assert.equal(choice.length, 300);
  for (const v of ['a', 'b', 'c']) {
    const n = choice.filter((x) => x === v).length;
    assert.ok(n > 60, `${v} salió ${n}`);
  }
  // dos ? distintos no deben ser idénticos
  const x = E('[a? b?]*8', 0, 16).map((e) => e[2]);
  assert.ok(x.includes('a') && x.includes('b'));
});

test('polimetría { }', () => {
  assert.deepEqual(E('{a b c}%4', 0, 1).map((x) => x[2]), ['a', 'b', 'c', 'a']);
  assert.deepEqual(E('{a b c}%4', 1, 2).map((x) => x[2]), ['b', 'c', 'a', 'b']);
  const two = E('{a b, c d e}');
  assert.equal(two.length, 4);
  assert.deepEqual(two.filter((x) => 'cde'.includes(x[2])).map((x) => x[2]), ['c', 'd']);
});

test('multiplicadores patroneados', () => {
  assert.deepEqual(E('a*<1 2>', 0, 2).map((x) => x[0]), ['0', '1', '3/2']);
  assert.deepEqual(E('a*[1 2]').map((x) => x[0]), ['0', '1/2']);
  assert.deepEqual(E('a*[2 4]').map((x) => x[0]), ['0', '1/2', '3/4']);
});

test('errores claros (MiniError con columna)', () => {
  for (const bad of ['[a b', 'a]', '<a b', 'a(3)', 'a(3,8,1,2)', 'a@', 'a@-1', 'a, b | c', '. a', '_ a', 'a . ', 'a!0', '(', '*2', 'a*']) {
    assert.throws(() => mini(bad), MiniError, `debería fallar: "${bad}"`);
  }
  try {
    mini('bd sn]');
  } catch (e) {
    assert.match(e.message, /columna 6/);
  }
});

test('tokenizer marca espacios previos', () => {
  const t = tokenize('a?0.3 b? 0.3');
  assert.equal(t[2].ws, false);
  assert.equal(t[5].ws, true);
  assert.deepEqual(vals(mini('a?0.3 b')).length <= 2, true);
});

test('caché: la misma cadena devuelve el mismo patrón', () => {
  assert.equal(mini('bd*4 sn'), mini('bd*4 sn'));
});

test('consultas partidas = consulta entera para muchas expresiones', () => {
  const exprs = [
    'bd sn', '[bd bd] <sn cp>', 'a*3 b/2', 'a@3 b!2 c', 'bd(3,8,<0 2>)', '{a b c}%<4 5>', '<a b>/3',
    'a? b?0.3 [c d]*1.5', 'a | b c | d', '[a, b*3, c/2]', '<a!2 b@2 c>', 'a _ b . c d _', '[0 .. 3]'.replace('..', ''),
  ];
  let seed = 7;
  const r = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  for (const s of exprs) {
    assertSplitInvariant(mini(s), 12, r, s);
    assertWellFormed(mini(s), 0, 12, s);
  }
});

test('fuzz: cadenas aleatorias -> patrón válido o MiniError, nunca otra excepción', () => {
  const alphabet = ['a', 'bd', 'sn:2', '0', '1.5', '-1', ' ', ' ', ' ', '[', ']', '<', '>', '{', '}', '(', ')', ',', '|', '*', '/', '!', '@', '?', '%', '~', '_', '.', '3', '8', '-'];
  let seed = 12345;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let parsed = 0;
  for (let i = 0; i < 4000; i++) {
    const len = 1 + Math.floor(r() * 14);
    let s = '';
    for (let j = 0; j < len; j++) s += alphabet[Math.floor(r() * alphabet.length)];
    let pat;
    try {
      pat = mini(s);
    } catch (e) {
      if (e instanceof MiniError) continue;
      // argumentos no numéricos en operadores (p. ej. "a*b") fallan al consultar, no al parsear
      throw new Error(`"${s}" lanzó ${e.name}: ${e.message}`);
    }
    parsed++;
    try {
      pat.queryArc(0, 3);
    } catch (e) {
      if (!/Se esperaba un número|No es un número/.test(e.message)) throw new Error(`"${s}" falló al consultar: ${e.message}`);
    }
  }
  assert.ok(parsed > 200, `sólo ${parsed} cadenas válidas`);
});
