import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Fraction, F } from '../src/core/fraction.js';
import { TimeSpan, Hap } from '../src/core/timespan.js';

test('normaliza y conserva el signo', () => {
  assert.equal(new Fraction(2, 4).toString(), '1/2');
  assert.equal(new Fraction(3, -6).toString(), '-1/2');
  assert.equal(new Fraction(0, 5).toString(), '0');
  assert.throws(() => new Fraction(1, 0), /denominador 0/);
});

test('aritmética exacta', () => {
  assert.equal(F(1).div(3).add(F(1).div(6)).toString(), '1/2');
  assert.equal(F('1/3').mul(3).toString(), '1');
  assert.equal(F('2/3').sub('1/3').toString(), '1/3');
  assert.equal(F(0.75).div(F(0.25)).toString(), '3');
  assert.throws(() => F(1).div(0), /División por cero/);
});

test('desde floats y strings', () => {
  assert.equal(F(0.1).toString(), '1/10');
  assert.equal(F(1 / 3).toString(), '1/3');
  assert.equal(F(0.125).toString(), '1/8');
  assert.equal(F(174 / 240).toString(), '29/40');
  assert.equal(F('3/16').toString(), '3/16');
  assert.equal(F('0.5').toString(), '1/2');
  assert.throws(() => F('hola'), /No es un número/);
  assert.throws(() => F(NaN), /no finito/);
  assert.throws(() => F(Infinity), /no finito/);
});

test('sam, nextSam y cyclePos (también negativos)', () => {
  assert.equal(F('7/4').sam().toString(), '1');
  assert.equal(F('7/4').nextSam().toString(), '2');
  assert.equal(F('7/4').cyclePos().toString(), '3/4');
  assert.equal(F('-1/4').sam().toString(), '-1');
  assert.equal(F('-1/4').cyclePos().toString(), '3/4');
  assert.equal(F(-2).sam().toString(), '-2');
});

test('comparaciones, min/max, mod', () => {
  assert.ok(F('1/3').lt('1/2'));
  assert.ok(F('1/2').gte('2/4'));
  assert.ok(F('1/2').eq(0.5));
  assert.equal(F('1/3').max('1/4').toString(), '1/3');
  assert.equal(F('1/3').min('1/4').toString(), '1/4');
  assert.equal(F(7).mod(3).toString(), '1');
  assert.equal(F(-1).mod(4).toString(), '3');
  assert.equal(F('9/2').mod(2).toString(), '1/2');
});

test('denominadores enormes se aproximan sin romperse', () => {
  let x = F(1);
  for (let i = 0; i < 60; i++) x = x.mul(F(1001).div(1000));
  assert.ok(Number.isFinite(x.valueOf()));
  assert.ok(Math.abs(x.valueOf() - 1.001 ** 60) < 1e-6);
  assert.ok(x.d <= 2 ** 48);
});

test('propiedades algebraicas con racionales aleatorios', () => {
  let seed = 42;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2000; i++) {
    const a = new Fraction(Math.floor(r() * 2000 - 1000), 1 + Math.floor(r() * 500));
    const b = new Fraction(Math.floor(r() * 2000 - 1000) || 1, 1 + Math.floor(r() * 500));
    assert.ok(a.add(b).sub(b).eq(a));
    assert.ok(a.mul(b).div(b).eq(a));
    assert.ok(a.add(b).eq(b.add(a)));
    assert.equal(a.lt(b), a.valueOf() < b.valueOf());
    assert.ok(a.sam().lte(a) && a.nextSam().gt(a));
  }
});

test('TimeSpan.spanCycles corta en los límites de ciclo', () => {
  const s = new TimeSpan(0, 2.5).spanCycles().map(String);
  assert.deepEqual(s, ['0→1', '1→2', '2→5/2']);
  assert.deepEqual(new TimeSpan(0.5, 0.75).spanCycles().map(String), ['1/2→3/4']);
  assert.deepEqual(new TimeSpan(1, 1).spanCycles().map(String), ['1→1']);
  assert.deepEqual(new TimeSpan(-0.5, 0.5).spanCycles().map(String), ['-1/2→0', '0→1/2']);
});

test('TimeSpan.intersection incluyendo ancho cero', () => {
  const a = new TimeSpan(0, 1);
  assert.equal(String(a.intersection(new TimeSpan(0.5, 2))), '1/2→1');
  assert.equal(a.intersection(new TimeSpan(1, 2)), null, 'adyacentes no se cortan');
  assert.equal(String(a.intersection(new TimeSpan(0.5, 0.5))), '1/2→1/2');
  assert.equal(String(a.intersection(new TimeSpan(0, 0))), '0→0');
  assert.equal(a.intersection(new TimeSpan(1, 1)), null, 'un punto en el borde final no cuenta');
  assert.equal(a.intersection(new TimeSpan(2, 3)), null);
});

test('Hap.hasOnset', () => {
  const w = new TimeSpan(0, 1);
  assert.ok(new Hap(w, new TimeSpan(0, 0.5), 'a').hasOnset());
  assert.ok(!new Hap(w, new TimeSpan(0.5, 1), 'a').hasOnset());
  assert.ok(!new Hap(null, new TimeSpan(0, 1), 'a').hasOnset());
});
