import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVoice, sampleRate, SYNTHS } from '../src/audio/params.js';
import { KIT, BREAKS, SOUND_NAMES, ALIASES } from '../src/audio/drums.js';
import { encodeWav, analyzeChannels } from '../src/audio/wav.js';
import { rng } from '../src/gen/generator.js';

test('defaults de synth y de sample', () => {
  const p = resolveVoice({ s: 'sub', note: 33 }, { duration: 0.5 });
  assert.equal(p.synth, true);
  assert.ok(Math.abs(p.freq - 55) < 1e-9);
  assert.equal(p.dur, 0.5);
  assert.equal(p.sustain, 1);
  assert.equal(p.hold, 0.5);
  const d = resolveVoice({ s: 'bd' }, { duration: 0.1 });
  assert.equal(d.synth, false);
  assert.equal(d.hold, null, 'los samples suenan completos por defecto');
  assert.equal(d.peak, 1);
  assert.equal(resolveVoice({ note: 60 }).s, 'triangle', 'nota sin sonido = triangle');
  assert.equal(resolveVoice({ gain: 1 }), null, 'sin s ni nota no hay voz');
  assert.equal(resolveVoice(60).s, 'triangle');
});

test('envolventes: decay sin sustain decae a cero, presets', () => {
  assert.equal(resolveVoice({ s: 'saw', decay: 0.2 }).sustain, 0);
  assert.equal(resolveVoice({ s: 'saw', decay: 0.2, sustain: 0.5 }).sustain, 0.5);
  assert.equal(resolveVoice({ s: 'pluck' }).sustain, 0);
  assert.equal(resolveVoice({ s: 'b808' }).decay, 0.9);
  assert.ok(resolveVoice({ s: 'b808' }).distort > 0);
});

test('clip/legato, fit, duck, delay sincronizado, wobble', () => {
  assert.equal(resolveVoice({ s: 'saw', clip: 2 }, { duration: 0.25 }).dur, 0.5);
  assert.equal(resolveVoice({ s: 'bd', clip: 0.5 }, { duration: 0.2 }).hold, 0.1);
  assert.deepEqual(resolveVoice({ s: 'bd', duck: 'bass:pads' }).duck, ['bass', 'pads']);
  assert.deepEqual(resolveVoice({ s: 'bd', duck: 'bass, pads' }).duck, ['bass', 'pads']);
  const cps = 0.725;
  assert.ok(Math.abs(resolveVoice({ s: 'saw', delay: 0.3 }, { cps }).delaytime - 3 / 16 / cps) < 1e-9);
  assert.equal(resolveVoice({ s: 'saw', delay: 0.3, delaytime: 0.2 }).delaytime, 0.2);
  assert.equal(resolveVoice({ s: 'reese', wob: 4 }).lpf, 500, 'wobble sin lpf usa 500 Hz');
  const brk = resolveVoice({ s: 'brk', begin: 0.25, end: 0.5, fit: 1 }, { duration: 0.1 });
  assert.ok(Math.abs(sampleRate(brk, 1.4) - (0.25 * 1.4) / 0.1) < 1e-9);
  assert.equal(sampleRate(resolveVoice({ s: 'bd', speed: -2 }), 1), 2);
  // como Strudel: un sample suena a su altura original con note("c2") (36)
  assert.ok(Math.abs(sampleRate(resolveVoice({ s: 'bd', note: 36 }), 1) - 1) < 1e-9);
  assert.ok(Math.abs(sampleRate(resolveVoice({ s: 'bd', note: 60 }), 1) - 4) < 1e-9);
  assert.ok(Math.abs(sampleRate(resolveVoice({ s: 'bd', note: 60 }), 1, 60) - 1) < 1e-9, 'mapas por nota: base de la clave');
  const inv = resolveVoice({ s: 'bd', begin: 0.8, end: 0.2 });
  assert.ok(inv.end > inv.begin);
});

test('fuzz: valores basura nunca rompen ni producen NaN/Infinity', () => {
  const r = rng(31337);
  const garbage = [NaN, Infinity, -Infinity, -1e9, 1e9, 0, -0, '', 'abc', 'c#9', 'zz', null, undefined, true, [], {}, '12', -3.5];
  const keys = ['note', 'n', 'freq', 'gain', 'velocity', 'postgain', 'pan', 'lpf', 'lpq', 'hpf', 'bpf', 'lpenv', 'attack', 'decay', 'sustain', 'release',
    'shape', 'distort', 'crush', 'room', 'size', 'delay', 'delaytime', 'delayfeedback', 'speed', 'begin', 'end', 'cut', 'clip', 'fm', 'fmh', 'detune',
    'unison', 'spread', 'vib', 'vibmod', 'subosc', 'wob', 'wobdepth', 'duckdepth', 'accelerate'];
  const sounds = [...SYNTHS, ...SOUND_NAMES, 'desconocido'];
  for (let i = 0; i < 5000; i++) {
    const v = { s: r.pick(sounds) };
    for (let k = 0; k < r.int(1, 10); k++) v[r.pick(keys)] = r.chance(0.5) ? r.pick(garbage) : r.float(-100, 30000);
    let p;
    assert.doesNotThrow(() => (p = resolveVoice(v, { duration: r.pick([0, 0.1, NaN, 5]), cps: r.pick([0.5, 0.725, 2]) })), JSON.stringify(v));
    for (const [k, x] of Object.entries(p)) {
      if (typeof x === 'number') assert.ok(Number.isFinite(x), `${k}=${x} con ${JSON.stringify(v)}`);
    }
    assert.ok(p.peak >= 0 && p.peak <= 128);
    assert.ok(p.pan >= 0 && p.pan <= 1);
    assert.ok(p.dur > 0);
    if (p.synth) assert.ok(p.freq >= 1 && p.freq <= 20000);
    if (p.lpf !== null) assert.ok(p.lpf >= 20 && p.lpf <= 20000);
    assert.ok(p.end > p.begin);
    assert.ok(p.delayfeedback < 1, 'feedback < 1 (sin auto-oscilación)');
    const rate = sampleRate(p, 1.5);
    assert.ok(Number.isFinite(rate) && rate > 0);
  }
});

test('datos del kit: todos los breaks usan sonidos y variantes existentes', () => {
  for (const [name, [secs, variants]] of Object.entries(KIT)) {
    assert.ok(secs > 0 && variants.length > 0 && variants.every((f) => typeof f === 'function'), name);
  }
  BREAKS.forEach((hits, i) => {
    assert.ok(hits.length > 8, `break ${i}`);
    for (const [step, snd, variant, g] of hits) {
      assert.ok(step >= 0 && step < 16, `break ${i}: paso ${step}`);
      assert.ok(KIT[snd], `break ${i}: sonido ${snd}`);
      assert.ok(variant < KIT[snd][1].length, `break ${i}: variante ${snd}:${variant}`);
      assert.ok(g > 0 && g <= 1);
    }
  });
  for (const [a, t] of Object.entries(ALIASES)) assert.ok(KIT[t], `alias ${a}`);
  for (const nm of ['bd', 'sn', 'hh', 'brk', 'riser', 'impact', 'kick', 'lt']) assert.ok(SOUND_NAMES.includes(nm));
  for (const nm of SOUND_NAMES) assert.ok(!SYNTHS.has(nm), `${nm} es synth y sample a la vez`);
});

test('WAV: cabecera y conversión de muestras', () => {
  const l = new Float32Array([0, 1, -1, 0.5, 2, NaN]);
  const r = new Float32Array([0, -0.5, 1, -2, 0, 0]);
  const buf = encodeWav([l, r], 44100);
  const v = new DataView(buf);
  const str = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));
  assert.equal(str(0, 4), 'RIFF');
  assert.equal(str(8, 4), 'WAVE');
  assert.equal(v.getUint32(4, true), 36 + 6 * 2 * 2);
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 44100);
  assert.equal(v.getUint32(28, true), 44100 * 4);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 24);
  const sample = (i, ch) => v.getInt16(44 + (i * 2 + ch) * 2, true);
  assert.equal(sample(1, 0), 32767);
  assert.equal(sample(2, 0), -32768);
  assert.equal(sample(4, 0), 32767, 'clip a +1');
  assert.equal(sample(3, 1), -32768, 'clip a -1');
  assert.equal(sample(5, 0), 0, 'NaN -> 0');
  assert.equal(buf.byteLength, 44 + 24);
});

test('analyzeChannels', () => {
  const a = analyzeChannels([new Float32Array([0, 0.5, -1, NaN])], 4);
  assert.equal(a.peak, 1);
  assert.equal(a.nan, 1);
  assert.equal(a.clipped, 1);
  assert.equal(a.seconds, 1);
  assert.ok(Math.abs(a.rms - Math.sqrt((0.25 + 1) / 3)) < 1e-9);
  const silent = analyzeChannels([new Float32Array(10)], 10);
  assert.equal(silent.peakDb, -Infinity);
});
