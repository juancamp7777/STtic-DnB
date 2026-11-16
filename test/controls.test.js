import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/core/index.js';
import { vals, ev } from './helpers.js';

const { s, n, note, gain, lpf, cutoff, mini, CONTROL_NAMES, CONTROL_DEFS, controls, Pattern } = P;

test('s() separa la variante', () => {
  assert.deepEqual(vals(s('bd:3 sn')), [{ s: 'bd', n: 3 }, { s: 'sn' }]);
  assert.deepEqual(vals(s('weird:name')), [{ s: 'weird:name' }]);
  assert.deepEqual(vals(s('bd', 'sn')), [{ s: 'bd' }, { s: 'sn' }], 'varios argumentos = secuencia');
});

test('los controles combinan con estructura desde la izquierda', () => {
  const p = s('bd').gain('0.5 1');
  const all = p.queryArc(0, 1);
  assert.equal(all.length, 2);
  const on = all.filter((h) => h.hasOnset());
  assert.equal(on.length, 1);
  assert.equal(on[0].value.gain, 0.5);
  assert.deepEqual(vals(s('bd*4').gain('<0.2 0.8>'), 1, 2).map((v) => v.gain), [0.8, 0.8, 0.8, 0.8]);
});

test('alias apuntan al nombre canónico', () => {
  assert.deepEqual(vals(s('x').cutoff(500)), [{ s: 'x', lpf: 500 }]);
  assert.deepEqual(vals(s('x').lp(500)), [{ s: 'x', lpf: 500 }]);
  assert.deepEqual(vals(s('x').legato(2)), [{ s: 'x', clip: 2 }]);
  assert.deepEqual(vals(s('x').sz(0.5)), [{ s: 'x', size: 0.5 }]);
  assert.deepEqual(vals(cutoff(300)), [{ lpf: 300 }]);
});

test('controles como funciones y sin argumentos', () => {
  assert.deepEqual(vals(gain('0.5 1')), [{ gain: 0.5 }, { gain: 1 }]);
  assert.deepEqual(vals(lpf(sine())), [], 'señal sin estructura no produce onsets');
  assert.deepEqual(vals(mini('0 2').n()), [{ n: 0 }, { n: 2 }]);
  assert.deepEqual(vals(n('0 1').s('bd')), [{ n: 0, s: 'bd' }, { n: 1, s: 'bd' }]);
  assert.deepEqual(vals(s('bd').duck('bass:pads')), [{ s: 'bd', duck: 'bass:pads' }]);
});

test('ningún control pisa métodos de patrón y todos existen como función y método', () => {
  for (const [canon, aliases] of CONTROL_DEFS) {
    for (const name of [canon, ...aliases]) {
      assert.ok(CONTROL_NAMES.has(name));
      assert.equal(typeof controls[name], 'function', name);
      assert.equal(typeof Pattern.prototype[name], 'function', name);
    }
  }
  // métodos críticos siguen siendo los de transformación
  assert.deepEqual(vals(mini('5').sub(2)), [3], 'sub es resta');
  assert.ok(vals(s('brk').fit()).every((v) => v.fit === 1), 'fit es estirar');
});

test('set() mezcla objetos', () => {
  assert.deepEqual(vals(s('bd').set({ gain: 0.3, pan: 0 })), [{ s: 'bd', gain: 0.3, pan: 0 }]);
  assert.equal(ev(note('c3').set(s('sub')))[0][2], 'note=48,s=sub');
});

function sine() {
  return P.sine;
}
