// Teoría musical: notas, escalas, acordes y voicings.
import { Pattern, register, reify, toObj, isObj, mod, num, fastcat, pure, setNoteParser, pitchOf } from './pattern.js';

const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const NOTE_RE = /^([a-gA-G])([#bsf]*)(-?\d+)?$/;

export const isNoteName = (x) => typeof x === 'string' && NOTE_RE.test(x.trim());

// "c3" = 48, "a4" = 69 (convención de Strudel: c4 = 60, octava por defecto 3)
export function noteToMidi(name) {
  if (typeof name === 'number') return name;
  const str = String(name).trim();
  const m = NOTE_RE.exec(str);
  if (!m) {
    const v = Number(str);
    if (str !== '' && !Number.isNaN(v)) return v;
    throw new Error(`Nota inválida: "${name}"`);
  }
  const [, letter, acc, oct] = m;
  let pc = PC[letter.toLowerCase()];
  for (const a of acc) pc += a === '#' || a === 's' ? 1 : -1;
  const octave = oct === undefined ? 3 : Number(oct);
  return (octave + 1) * 12 + pc;
}
setNoteParser(noteToMidi);

export const midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);
export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);
const NAMES = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];
export const midiToName = (m) => `${NAMES[mod(Math.round(m), 12)]}${Math.floor(Math.round(m) / 12) - 1}`;

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicminor: [0, 2, 3, 5, 7, 8, 11],
  melodicminor: [0, 2, 3, 5, 7, 9, 11],
  majorpentatonic: [0, 2, 4, 7, 9],
  pentatonic: [0, 2, 4, 7, 9],
  minorpentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  wholetone: [0, 2, 4, 6, 8, 10],
  hirajoshi: [0, 2, 3, 7, 8],
  phrygiandominant: [0, 1, 4, 5, 7, 8, 10],
  hungarianminor: [0, 2, 3, 6, 7, 8, 11],
};
const normName = (s) => s.toLowerCase().replace(/[\s_\-]/g, '');

export function parseScale(name) {
  const parts = String(name).split(':');
  let tonic = 'c';
  let type;
  if (parts.length > 1 && /^[a-gA-G][#bs]*-?\d*$/.test(parts[0])) {
    tonic = parts[0];
    type = parts.slice(1).join('');
  } else type = parts.join('');
  const steps = SCALES[normName(type)];
  if (!steps) throw new Error(`Escala desconocida: "${type}". Disponibles: ${Object.keys(SCALES).join(', ')}`);
  return { root: noteToMidi(tonic), steps };
}

export function degreeToMidi(deg, scaleName) {
  const { root, steps } = parseScale(scaleName);
  const d = Math.floor(num(deg) + 1e-9);
  const len = steps.length;
  return root + steps[mod(d, len)] + 12 * Math.floor(d / len);
}

// Tipos de acorde (nombres canónicos). Los alias de iReal/Strudel (-7, ^7, +, o, h7, ø, Δ, M7...)
// se normalizan con canonQuality().
export const CHORDS = {
  '': [0, 4, 7], maj: [0, 4, 7], 5: [0, 7], 2: [0, 2, 4, 7], add2: [0, 2, 4, 7], add9: [0, 4, 7, 14], add11: [0, 4, 7, 17],
  6: [0, 4, 7, 9], 69: [0, 4, 7, 9, 14], sus: [0, 5, 7], sus4: [0, 5, 7], sus2: [0, 2, 7],
  7: [0, 4, 7, 10], '7sus': [0, 5, 7, 10], '7sus4': [0, 5, 7, 10], 9: [0, 4, 7, 10, 14], '9sus': [0, 5, 7, 10, 14],
  '9sus4': [0, 5, 7, 10, 14], 11: [0, 4, 7, 10, 14, 17], 13: [0, 4, 7, 10, 14, 21], '13sus': [0, 5, 7, 10, 14, 21],
  '13sus4': [0, 5, 7, 10, 14, 21], '7b9': [0, 4, 7, 10, 13], '7#9': [0, 4, 7, 10, 15], '7#11': [0, 4, 7, 10, 18],
  '7b5': [0, 4, 6, 10], '7#5': [0, 4, 8, 10], '7b13': [0, 4, 7, 10, 20], '7alt': [0, 4, 10, 13, 15, 20],
  '7b9sus': [0, 5, 7, 10, 13], '7b13sus': [0, 5, 7, 10, 20], '7b9b13': [0, 4, 10, 13, 20], '7#9b13': [0, 4, 10, 15, 20],
  '7#9#5': [0, 4, 8, 10, 15], '7#9b5': [0, 4, 6, 10, 15], '7b9b5': [0, 4, 6, 10, 13], '7b9#5': [0, 4, 8, 10, 13],
  '7susadd3': [0, 4, 5, 7, 10],
  '7b9#11': [0, 4, 10, 13, 18], '7#9#11': [0, 4, 10, 15, 18], '7#5#9': [0, 4, 8, 10, 15], '7b5b9': [0, 4, 6, 10, 13],
  '7b9#9': [0, 4, 10, 13, 15], '9#11': [0, 4, 7, 10, 14, 18], '9b5': [0, 4, 6, 10, 14], '9#5': [0, 4, 8, 10, 14],
  '13#11': [0, 4, 7, 10, 14, 18, 21], '13b9': [0, 4, 7, 10, 13, 21], '13#9': [0, 4, 7, 10, 15, 21],
  aug: [0, 4, 8], aug7: [0, 4, 8, 10], aug9: [0, 4, 8, 10, 14], dim: [0, 3, 6], dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10], m9b5: [0, 3, 6, 10, 14], m11b5: [0, 3, 6, 10, 14, 17],
  m: [0, 3, 7], m6: [0, 3, 7, 9], m69: [0, 3, 7, 9, 14], m7: [0, 3, 7, 10], m7b9: [0, 3, 7, 10, 13], m9: [0, 3, 7, 10, 14],
  m11: [0, 3, 7, 10, 14, 17], m13: [0, 3, 7, 10, 14, 21], madd9: [0, 3, 7, 14], mM7: [0, 3, 7, 11], mM9: [0, 3, 7, 11, 14],
  'm#5': [0, 3, 8], 'm7#5': [0, 3, 8, 10], mb6: [0, 3, 7, 8],
  maj7: [0, 4, 7, 11], maj9: [0, 4, 7, 11, 14], maj13: [0, 4, 7, 11, 14, 21], 'maj7#11': [0, 4, 7, 11, 18],
  'maj9#11': [0, 4, 7, 11, 14, 18], 'maj7#5': [0, 4, 8, 11], 'maj13#11': [0, 4, 7, 11, 14, 18, 21], maj69: [0, 4, 7, 9, 14],
};

// Alias habituales (iReal / Strudel / cifrado clásico) -> nombre canónico
export function canonQuality(q) {
  let s = String(q).replace(/[\s()]/g, '');
  if (s in CHORDS) return s;
  if (s === '^' || s === 'Δ' || s === '∆') return 'maj7';
  if (s === 'ø' || s === 'h' || s === 'h7' || s === 'ø7') return 'm7b5';
  if (s === 'h9' || s === 'ø9') return 'm9b5';
  if (s === 'M') return 'maj';
  s = s
    .replace(/^(min|mi|-)/, 'm')
    .replace(/^m\^/, 'mM')
    .replace(/^mmaj/, 'mM')
    .replace(/^(\^|Δ|∆|M(?=[0-9#b]|$)|Maj)/, 'maj')
    .replace(/^\+/, 'aug')
    .replace(/^o/, 'dim')
    .replace(/^dim7?b5$/, 'dim');
  if (s === 'maj' && /^[\^Δ∆]/.test(String(q))) s = 'maj7';
  if (/^maj[#b]/.test(s)) s = s.replace(/^maj/, 'maj7');
  return s;
}

export function parseChord(sym) {
  const m = /^([A-Ga-g])([#b]?)([^/]*)(?:\/([A-Ga-g][#b]?))?$/.exec(String(sym).trim());
  if (!m) throw new Error(`Acorde inválido: "${sym}"`);
  const [, l, acc, qual, bass] = m;
  const root = mod(PC[l.toLowerCase()] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0), 12);
  const intervals = CHORDS[canonQuality(qual)];
  if (!intervals) throw new Error(`Tipo de acorde desconocido: "${qual}" en "${sym}"`);
  const bassPc = bass ? mod(noteToMidi(bass), 12) : root;
  return { root, intervals, bass: bassPc };
}

const uniqSorted = (xs) => [...new Set(xs)].sort((a, b) => a - b);

// Voicings como Strudel:
//   mode "below" (por defecto): la nota más aguda queda en (ancla-12, ancla]
//   mode "above": la más grave queda en [ancla, ancla+12)
//   mode "duck":  como below pero sin tocar el ancla (top < ancla)
//   mode "root":  posición fundamental con la raíz justo por debajo (o en) el ancla
// offset: inversiones (+1 sube la nota más grave una octava; -1 baja la más aguda).
export function voiceChord(sym, anchor = 72, mode = 'below', offset = 0) {
  const { root, intervals } = parseChord(sym);
  const a = typeof anchor === 'string' ? noteToMidi(anchor) : num(anchor);
  let notes = uniqSorted(intervals.map((i) => 48 + root + i));
  if (mode === 'root') {
    const r = a - mod(a - (48 + root), 12);
    notes = uniqSorted(intervals.map((i) => r + i));
  } else if (mode === 'above') {
    for (let guard = 0; guard < 48; guard++) {
      const low = notes[0];
      if (low < a) notes = uniqSorted([...notes.slice(1), low + 12]);
      else if (low >= a + 12) notes = uniqSorted([...notes.slice(0, -1), notes[notes.length - 1] - 12]);
      else break;
    }
  } else {
    const top = mode === 'duck' ? a - 1 : a;
    for (let guard = 0; guard < 48; guard++) {
      const hi = notes[notes.length - 1];
      if (hi > top) notes = uniqSorted([...notes.slice(0, -1), hi - 12]);
      else if (hi <= top - 12) notes = uniqSorted([notes[0] + 12, ...notes.slice(1)]);
      else break;
    }
  }
  const off = Math.round(num(offset) || 0);
  for (let i = 0; i < Math.abs(off); i++) {
    notes = off > 0 ? uniqSorted([...notes.slice(1), notes[0] + 12]) : uniqSorted([notes[notes.length - 1] - 12, ...notes.slice(0, -1)]);
  }
  return notes;
}

// octave: número (octava fija) o nombre de nota (la nota más grave permitida, p. ej. "e1"
// deja todas las fundamentales entre E1 y Eb2: rango ideal de sub en DnB).
export function chordRoot(sym, octave = 2) {
  const pc = parseChord(sym).bass;
  if (typeof octave === 'string' && isNoteName(octave)) {
    const floor = noteToMidi(octave);
    return floor + mod(pc - floor, 12);
  }
  return (num(octave) + 1) * 12 + pc;
}

// --- métodos de patrón ---
register('scale', 1, (pat, name) =>
  pat.fmap((v) => {
    if (isObj(v)) {
      const deg = v.n ?? v.note ?? 0;
      const { n, ...rest } = v;
      return { ...rest, note: degreeToMidi(deg, name) };
    }
    return { note: degreeToMidi(v, name) };
  }),
);

const chordOf = (v) => (isObj(v) ? v.chord : typeof v === 'string' ? v : null);

// Convierte un valor con acorde en sus notas (respetando anchor/mode/offset/n del propio valor).
function voiceValue(v, anchorArg) {
  const sym = chordOf(v);
  if (!sym) return [v];
  const { chord, anchor, mode, offset, dict, n, ...rest } = toObj(v);
  const notes = voiceChord(sym, anchor ?? anchorArg ?? 72, mode ?? 'below', offset ?? 0);
  // n elige una nota del voicing (como en Strudel: n("0 1 2 3").chord("C").voicing() arpegia)
  if (n != null && Number.isFinite(Number(n))) {
    const i = Math.floor(Number(n));
    return [{ ...rest, note: notes[mod(i, notes.length)] + 12 * Math.floor(i / notes.length) }];
  }
  return notes.map((note) => ({ ...rest, note }));
}

Pattern.prototype.voicing = function (anchor) {
  return this.flatValues((v) => voiceValue(v, anchor));
};
Pattern.prototype.voicings = Pattern.prototype.voicing;

register('rootNotes', 1, (pat, octave = 2) =>
  pat.fmap((v) => {
    const sym = chordOf(v);
    if (!sym) return v;
    const { chord, anchor, mode, offset, dict, ...rest } = toObj(v);
    return { ...rest, note: chordRoot(sym, octave ?? 2) };
  }),
);

const ARP_MODES = {
  up: (k) => [...Array(k).keys()],
  down: (k) => [...Array(k).keys()].reverse(),
  updown: (k) => [...Array(k).keys(), ...[...Array(k).keys()].reverse().slice(1, -1)],
  downup: (k) => [...[...Array(k).keys()].reverse(), ...[...Array(k).keys()].slice(1, -1)],
};
// arp como en Strudel: elige entre las notas que suenan a la vez (acordes apilados o voicings).
//   note("<[c,eb,g] [c,f,ab]>").arp("0 [0,2] 1 [0,2]")   chord("<Dm9 Bb^7>").arp("up")
// Los valores con chord() se convierten antes en voicing. Índices fuera de rango dan la vuelta.
const looksLikeChord = (s) => {
  if (typeof s !== 'string' || !/^[A-G]/.test(s)) return false;
  try {
    parseChord(s);
    return true;
  } catch {
    return false;
  }
};
// altura para ordenar el arpegio: números, { note/n/freq } numéricos y nombres de nota ("c3", { note: "e3" })
const arpPitch = (v) => {
  const p = pitchOf(v);
  if (p !== null) return p;
  const x = isObj(v) ? v.note ?? v.n : v;
  return typeof x === 'string' && isNoteName(x) ? noteToMidi(x) : null;
};
Pattern.prototype.arp = function (idx) {
  const idxPat = reify(idx);
  const voiced = this.flatValues((v) => (isObj(v) && v.chord != null ? voiceValue({ ...v, n: undefined }) : [v]));
  return voiced.arpWith((group) => {
    // un acorde escrito como texto ("<Dm9 Bb^7>".arp("up")) también se arpegia
    const vs = group.length === 1 && looksLikeChord(group[0]) ? voiceValue({ chord: group[0] }) : group;
    // los índices respetan el orden escrito (como Strudel); los modos up/down… van por altura
    // (también con nombres de nota en texto: "[e3,c3,g3]".arp("up").note())
    const byPitch = vs.every((v) => arpPitch(v) !== null) ? [...vs].sort((a, b) => arpPitch(a) - arpPitch(b)) : vs;
    return idxPat
      .fmap((i) => {
        if (typeof i === 'string' && ARP_MODES[i]) return fastcat(...ARP_MODES[i](byPitch.length).map((k) => byPitch[k]));
        return pure(vs[mod(Math.round(num(i)), vs.length)]);
      })
      .squeezeJoin();
  });
};
