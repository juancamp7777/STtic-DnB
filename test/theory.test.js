import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/core/index.js';
import { vals } from './helpers.js';

const { noteToMidi, midiToFreq, freqToMidi, midiToName, degreeToMidi, parseScale, parseChord, voiceChord, chordRoot, CHORDS, SCALES, chord, n, note, s } = P;

test('nombres de nota a MIDI', () => {
  assert.equal(noteToMidi('c3'), 48);
  assert.equal(noteToMidi('c4'), 60);
  assert.equal(noteToMidi('a4'), 69);
  assert.equal(noteToMidi('c#3'), 49);
  assert.equal(noteToMidi('db3'), 49);
  assert.equal(noteToMidi('cs3'), 49);
  assert.equal(noteToMidi('bb2'), 46);
  assert.equal(noteToMidi('e'), 52);
  assert.equal(noteToMidi('C3'), 48);
  assert.equal(noteToMidi('c-1'), 0);
  assert.equal(noteToMidi('cb4'), 59);
  assert.equal(noteToMidi(61), 61);
  assert.equal(noteToMidi('62'), 62);
  assert.throws(() => noteToMidi('h3'), /Nota inválida/);
  assert.throws(() => noteToMidi(''), /Nota inválida/);
});

test('frecuencias', () => {
  assert.equal(midiToFreq(69), 440);
  assert.ok(Math.abs(midiToFreq(57) - 220) < 1e-9);
  assert.ok(Math.abs(freqToMidi(880) - 81) < 1e-9);
  assert.equal(midiToName(60), 'c4');
  assert.equal(midiToName(46), 'bb2');
  for (let m = 0; m < 128; m++) assert.equal(noteToMidi(midiToName(m)), m);
});

test('escalas', () => {
  assert.equal(degreeToMidi(0, 'C:major'), 48);
  assert.equal(degreeToMidi(7, 'C:major'), 60);
  assert.equal(degreeToMidi(-1, 'C:major'), 47);
  assert.equal(degreeToMidi(2, 'D:minor'), 53);
  assert.equal(degreeToMidi(0, 'E4:minor'), 64);
  assert.equal(degreeToMidi(4, 'minor pentatonic'), 58);
  assert.equal(degreeToMidi(1.9, 'C:major'), 50, 'grados fraccionarios se redondean hacia abajo');
  assert.equal(parseScale('Bb3:dorian').root, 58);
  assert.equal(parseScale('F#:harmonic_minor').steps.length, 7);
  assert.throws(() => degreeToMidi(0, 'C:inventada'), /Escala desconocida/);
  for (const [name, steps] of Object.entries(SCALES)) {
    assert.ok(steps[0] === 0 && steps.every((x, i) => i === 0 || x > steps[i - 1]) && steps.at(-1) < 12, name);
    // monotonía: subir grados siempre sube la nota
    for (let d = -10; d < 20; d++) assert.ok(degreeToMidi(d + 1, `C:${name}`) > degreeToMidi(d, `C:${name}`), `${name} ${d}`);
  }
  assert.deepEqual(vals(n('0 2 4').scale('D:minor')).map((v) => v.note), [50, 53, 57]);
  assert.deepEqual(vals(n('0').scale('<C:major A:minor>'), 1, 2).map((v) => v.note), [57]);
  assert.ok(!('n' in vals(n('0').scale('C:major'))[0]));
});

test('acordes: análisis y errores', () => {
  assert.deepEqual(parseChord('Dm9'), { root: 2, intervals: [0, 3, 7, 10, 14], bass: 2 });
  assert.deepEqual(parseChord('Bb^7').root, 10);
  assert.deepEqual(parseChord('C/E').bass, 4);
  assert.deepEqual(parseChord('F#m7b5').intervals, [0, 3, 6, 10]);
  assert.throws(() => parseChord('Cxyz'), /desconocido/);
  assert.throws(() => parseChord('H7'), /inválido/);
});

test('voicings: siempre debajo del ancla, sin duplicados, ordenados (12 raíces × todos los tipos)', () => {
  const roots = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  for (const r of roots) {
    for (const q of Object.keys(CHORDS)) {
      const sym = r + q;
      for (const anchor of [72, 67, 60]) {
        const v = voiceChord(sym, anchor);
        assert.ok(v.length >= Math.min(2, CHORDS[q].length), sym);
        assert.ok(v.at(-1) <= anchor && v.at(-1) > anchor - 12, `${sym} ancla ${anchor}: ${v}`);
        assert.deepEqual([...v].sort((a, b) => a - b), v);
        assert.equal(new Set(v).size, v.length);
        // todas las clases de altura pertenecen al acorde
        const pcs = new Set(CHORDS[q].map((i) => (parseChord(sym).root + i) % 12));
        for (const x of v) assert.ok(pcs.has(((x % 12) + 12) % 12), `${sym}: nota ajena ${x}`);
      }
    }
  }
});

test('rootNotes: octava fija o nota mínima', () => {
  assert.equal(chordRoot('Dm9', 1), 26);
  assert.equal(chordRoot('C/E', 2), 40);
  for (const r of ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']) {
    const m = chordRoot(`${r}m7`, 'e1');
    assert.ok(m >= 28 && m <= 39, `${r}: ${m}`);
  }
  assert.deepEqual(vals(chord('<Dm9 Bb^7>').rootNotes(1), 0, 2).map((v) => v.note), [26, 34]);
});

test('chord().voicing() y arp()', () => {
  const v = vals(chord('Dm9').voicing());
  assert.equal(v.length, 5);
  assert.ok(v.every((x) => typeof x.note === 'number' && !('chord' in x)));
  const up = vals(chord('C').arp('up')).map((x) => x.note);
  assert.deepEqual(up, [...up].sort((a, b) => a - b));
  assert.equal(up.length, 3);
  // como Strudel: los índices dan la vuelta (sin subir de octava)
  assert.equal(vals(chord('C').arp('0 3')).map((x) => x.note)[1], vals(chord('C').arp('0'))[0].note);
  assert.equal(vals(chord('<C Am>').arp('updown'), 1, 2).length, 4);
  // arp mantiene otros controles
  assert.ok(vals(chord('C').s('pluck').arp('0 1')).every((x) => x.s === 'pluck'));
});

test('controles con nota', () => {
  assert.deepEqual(vals(note('c3 a4 61')).map((v) => v.note), [48, 69, 61]);
  assert.deepEqual(vals(s('sub').note('d1')).map((v) => v.note), [26]);
});
