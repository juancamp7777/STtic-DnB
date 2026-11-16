// Funciones añadidas para no echar nada de menos respecto a Strudel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mini, MiniError, s, note, adsr } from '../src/core/index.js';
import { evaluate, defineMethod } from '../src/core/eval.js';
import { resolveVoice, VOWELS } from '../src/audio/params.js';
import { vals, ev } from './helpers.js';

test('rangos en mini-notación: "0 .. 4"', () => {
  assert.deepEqual(vals(mini('0 .. 4')), [0, 1, 2, 3, 4]);
  assert.deepEqual(vals(mini('3 .. 0')), [3, 2, 1, 0]);
  assert.deepEqual(vals(mini('a 2 .. 4')), ['a', 2, 3, 4]);
  // el rango ocupa un único paso (como Tidal/Strudel)
  assert.deepEqual(vals(mini('<0 .. 2>'), 0, 3), [0, 1, 2, 0, 1, 2, 0, 1, 2]);
  assert.deepEqual(ev(mini('0 .. 3 8')).map((x) => x[0]), ['0', '1/8', '1/4', '3/8', '1/2']);
  assert.deepEqual(vals(mini('[0 .. 3]*2')).length, 8);
  for (const bad of ['.. 3', '0 ..', 'a .. 3', '0 .. b', '0.5 .. 2', '0 .. 5000', '0!2 .. 3']) {
    assert.throws(() => mini(bad), MiniError, bad);
  }
});

test('adsr("a:d:s:r")', () => {
  assert.deepEqual(vals(adsr('.01:.1:.5:.2')), [{ attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 }]);
  assert.deepEqual(vals(note('c3').adsr('0:.2')), [{ note: 48, attack: 0, decay: 0.2 }]);
  assert.deepEqual(vals(note('c3').adsr('<.1:.1:1:.1 .5::0>'), 1, 2), [{ note: 48, attack: 0.5, sustain: 0 }]);
  const p = resolveVoice({ s: 'saw', ...vals(adsr('.01:.1:.5:.2'))[0] });
  assert.equal(p.attack, 0.01);
  assert.equal(p.sustain, 0.5);
});

test('envolvente de tono y vocales', () => {
  const p = resolveVoice({ s: 'sine', note: 36, penv: 24, pdecay: 0.05 });
  assert.equal(p.penv, 24);
  assert.equal(p.pdecay, 0.05);
  assert.equal(resolveVoice({ s: 'sine' }).penv, 0);
  assert.equal(resolveVoice({ s: 'sine', penv: 999 }).penv, 48);
  assert.equal(resolveVoice({ s: 'saw', vowel: 'A' }).vowel, 'a');
  assert.equal(resolveVoice({ s: 'saw', vowel: 'x' }).vowel, null);
  for (const v of Object.values(VOWELS)) assert.equal(v.length, 3);
  assert.deepEqual(vals(s('saw*2').vowel('<a e>'), 1, 2).map((x) => x.vowel), ['e', 'e']);
});

test('all(f) transforma todas las pistas', async () => {
  const r = await evaluate('a: s("bd*4")\nb: s("hh*8")\nall(x => x.fast(2))');
  assert.equal(ev(r.tracks[0].pattern).length, 8);
  assert.equal(ev(r.tracks[1].pattern).length, 16);
  const r2 = await evaluate('all(x => x.lpf(500))\nstack(s("bd"))');
  assert.equal(vals(r2.tracks[0].pattern)[0].lpf, 500, 'se aplica también a la expresión suelta');
  await assert.rejects(evaluate('all(5)\ns("bd")'), /necesita una función/);
  await assert.rejects(evaluate('all(x => x.noExiste())\ns("bd")'), /all\(\)/);
});

test('define() crea métodos propios sin pisar los existentes', async () => {
  const r = await evaluate('define("tuneado", (p, n) => p.lpf(n).room(.2))\nx: s("bd").tuneado(300)');
  assert.deepEqual(vals(r.tracks[0].pattern), [{ s: 'bd', lpf: 300, room: 0.2 }]);
  // redefinir un método propio está permitido (para iterar en vivo)
  await evaluate('define("tuneado", (p) => p.gain(.5))');
  assert.deepEqual(vals(s('bd').tuneado()), [{ s: 'bd', gain: 0.5 }]);
  assert.throws(() => defineMethod('fast', (p) => p), /ya existe/);
  assert.throws(() => defineMethod('mal nombre', (p) => p), /nombre inválido/);
  assert.throws(() => defineMethod('x1', 5), /función/);
});
