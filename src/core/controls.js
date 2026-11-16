// Controles: s, n, note, gain, lpf... Cada uno existe como función (s("bd"))
// y como método (pat.gain(0.5)). La estructura viene siempre del patrón de la izquierda.
import { Pattern, reify, toObj, fastcat, isObj } from './pattern.js';
import { noteToMidi, isNoteName } from './theory.js';

const asNumber = (x) => {
  if (typeof x === 'number' || typeof x === 'boolean' || x == null) return x;
  const v = Number(x);
  return Number.isNaN(v) ? x : v;
};
const asString = (x) => (x == null ? x : String(x));
const asNoteOrString = (x) => (typeof x === 'number' ? x : isNoteName(x) ? x : asNumber(x));

// s("bd:3:0.5") = sonido : variante : ganancia (como en Strudel)
function parseS(x) {
  if (isObj(x)) return x;
  const str = String(x);
  const parts = str.split(':');
  if (parts.length > 1) {
    const n = Number(parts[1]);
    if (parts[1] !== '' && !Number.isNaN(n)) {
      const out = { s: parts[0], n };
      if (parts.length > 2 && parts[2] !== '' && Number.isFinite(Number(parts[2]))) out.gain = Number(parts[2]);
      return out;
    }
  }
  return { s: str };
}
const parseNote = (x) => (typeof x === 'number' ? x : isNoteName(x) ? noteToMidi(x) : asNumber(x));

// adsr(".01:.1:.5:.2") -> attack/decay/sustain/release (los valores vacíos se omiten)
function parseADSR(x) {
  if (isObj(x)) return x;
  const keys = ['attack', 'decay', 'sustain', 'release'];
  const out = {};
  String(x)
    .split(':')
    .forEach((v, i) => {
      if (i < 4 && v.trim() !== '' && Number.isFinite(Number(v))) out[keys[i]] = Number(v);
    });
  return out;
}

// Valores compuestos de Strudel: lpf("800:8") = lpf 800 + lpq 8, delay(".5:.125:.8") = delay:delaytime:feedback...
export const COMPOUND = {
  lpf: ['lpf', 'lpq', 'lpenv'],
  hpf: ['hpf', 'hpq', 'hpenv'],
  bpf: ['bpf', 'bpq', 'bpenv'],
  room: ['room', 'size'],
  delay: ['delay', 'delaytime', 'delayfeedback'],
  vib: ['vib', 'vibmod'],
  vibmod: ['vibmod', 'vib'],
  fm: ['fm', 'fmh'],
  phaser: ['phaser', 'phaserdepth'],
  distort: ['distort', 'distortvol'],
  shape: ['shape', 'shapevol'],
  mode: ['mode', 'anchor'],
};
// en estos compuestos las partes son texto (p. ej. mode("below:c4"))
const COMPOUND_TEXT = new Set(['mode']);
function compoundParser(keys, parse, text = false) {
  return (x) => {
    if (isObj(x)) return x;
    if (typeof x === 'string' && x.includes(':')) {
      const out = {};
      x.split(':').forEach((v, i) => {
        if (i >= keys.length || v.trim() === '') return;
        if (text) out[keys[i]] = v.trim();
        else if (Number.isFinite(Number(v))) out[keys[i]] = Number(v);
      });
      if (Object.keys(out).length) return out;
    }
    return { [keys[0]]: parse(x) };
  };
}

// [nombre canónico, alias, parser]
export const CONTROL_DEFS = [
  ['s', ['sound'], null],
  ['n', [], asNumber],
  ['note', [], parseNote],
  ['freq', [], asNumber],
  ['gain', [], asNumber],
  ['velocity', ['vel'], asNumber],
  ['postgain', [], asNumber],
  ['pan', [], asNumber],
  ['lpf', ['cutoff', 'lp', 'ctf'], asNumber],
  ['lpq', ['resonance'], asNumber],
  ['hpf', ['hcutoff', 'hp'], asNumber],
  ['hpq', ['hresonance'], asNumber],
  ['bpf', ['bandf', 'bp'], asNumber],
  ['bpq', ['bandq'], asNumber],
  ['lpenv', ['lpe'], asNumber],
  ['lpattack', ['lpa'], asNumber],
  ['lpdecay', ['lpd'], asNumber],
  ['lpsustain', ['lps'], asNumber],
  ['lprelease', ['lpr'], asNumber],
  ['hpenv', ['hpe'], asNumber],
  ['bpenv', ['bpe'], asNumber],
  ['ftype', [], asString],
  ['attack', ['att'], asNumber],
  ['decay', ['dec'], asNumber],
  ['sustain', ['sus'], asNumber],
  ['release', ['rel'], asNumber],
  ['shape', [], asNumber],
  ['shapevol', [], asNumber],
  ['distort', ['dist'], asNumber],
  ['distortvol', ['distvol'], asNumber],
  ['crush', [], asNumber],
  ['coarse', [], asNumber],
  ['room', [], asNumber],
  ['size', ['sz', 'roomsize', 'rsize'], asNumber],
  ['delay', [], asNumber],
  ['delaytime', ['dt'], asNumber],
  ['delayfeedback', ['dfb', 'delayfb'], asNumber],
  ['delaysync', [], asNumber],
  ['speed', [], asNumber],
  ['begin', [], asNumber],
  ['end', [], asNumber],
  ['cut', [], asNumber],
  ['clip', ['legato'], asNumber],
  ['accelerate', [], asNumber],
  ['fm', ['fmi'], asNumber],
  ['fmh', [], asNumber],
  ['fmdecay', [], asNumber],
  ['fmenv', [], asString],
  ['fmattack', [], asNumber],
  ['fmsustain', [], asNumber],
  ['detune', [], asNumber],
  ['unison', [], asNumber],
  ['spread', [], asNumber],
  ['vib', ['vibrato', 'v'], asNumber],
  ['vibmod', ['vmod'], asNumber],
  ['subosc', [], asNumber],
  ['noise', [], asNumber],
  ['phaser', [], asNumber],
  ['phaserdepth', [], asNumber],
  ['wob', [], asNumber],
  ['wobdepth', [], asNumber],
  ['duck', ['duckorbit'], asString],
  ['duckdepth', [], asNumber],
  ['duckonset', [], asNumber],
  ['duckattack', [], asNumber],
  ['duckhold', [], asNumber],
  ['duckrelease', [], asNumber],
  ['bank', [], asString],
  ['chord', [], asString],
  ['anchor', [], asNoteOrString],
  ['mode', [], asString],
  ['offset', [], asNumber],
  ['dict', [], asString],
  ['orbit', [], asNumber],
  ['adsr', [], null],
  ['penv', [], asNumber],
  ['pattack', [], asNumber],
  ['pdecay', [], asNumber],
  ['vowel', [], asString],
  ['midi', [], asString],
  ['midichan', [], asNumber],
  ['midiport', [], asString],
];

// Controles cuyo valor debe ser numérico (el analizador avisa si reciben texto).
export const NUMERIC_CONTROLS = new Set(CONTROL_DEFS.filter(([, , p]) => p === asNumber).map(([c]) => c));

// Seguridad: ningún control puede pisar un método de patrón existente.
for (const [canon, aliases] of CONTROL_DEFS) {
  for (const name of [canon, ...aliases]) {
    if (name in Pattern.prototype) throw new Error(`El control "${name}" choca con un método de Pattern`);
  }
}

export const CONTROL_NAMES = new Set();
export const controls = {};

function makeControl(canon, parse) {
  const toValue =
    canon === 's'
      ? parseS
      : canon === 'adsr'
        ? parseADSR
        : COMPOUND[canon]
          ? compoundParser(COMPOUND[canon], parse, COMPOUND_TEXT.has(canon))
          : (x) => (isObj(x) ? x : { [canon]: parse(x) });
  const create = (...args) => {
    const src = args.length > 1 ? fastcat(...args) : reify(args[0]);
    return src.fmap(toValue);
  };
  const method = function (...args) {
    if (args.length === 0) return this.fmap(toValue);
    const other = create(...args);
    return this.appLeft(other, (a, b) => ({ ...toObj(a), ...b }));
  };
  return { create, method };
}

for (const [canon, aliases, parse] of CONTROL_DEFS) {
  const { create, method } = makeControl(canon, parse);
  for (const name of [canon, ...aliases]) {
    CONTROL_NAMES.add(name);
    controls[name] = create;
    Pattern.prototype[name] = method;
  }
}

// .midi() sin argumentos = salida MIDI por defecto; .midi("Mi sinte") = puerto por nombre
Pattern.prototype.midi = function (port) {
  if (port === undefined) return this.fmap((v) => ({ ...toObj(v), midi: 'default' }));
  // el nombre del puerto puede tener espacios: no se interpreta como mini-notación
  if (!(port instanceof Pattern)) return this.fmap((v) => ({ ...toObj(v), midi: String(port) }));
  return this.appLeft(port, (a, b) => ({ ...toObj(a), midi: String(b) }));
};

// Exportaciones con nombre (para usar el núcleo como librería: import { s, note } from ...)
export const {
  s, sound, n, note, freq, gain, velocity, vel, postgain, pan, lpf, cutoff, lp, ctf, lpq, resonance, hpf, hcutoff, hp, hpq,
  hresonance, bpf, bandf, bp, bpq, bandq, lpenv, lpe, lpattack, lpa, lpdecay, lpd, lpsustain, lps, lprelease, lpr, hpenv,
  hpe, bpenv, bpe, ftype, attack, att, decay, dec, sustain, sus, release, rel, shape, shapevol, distort, dist, distortvol,
  distvol, crush, coarse, room,
  size, sz, roomsize, rsize, delay, delaytime, dt, delayfeedback, dfb, delayfb, delaysync, speed, begin, end, cut, clip,
  legato, accelerate, fm, fmi, fmh, fmdecay, fmenv, fmattack, fmsustain, detune, unison, spread, vib, vibrato, v, vibmod, vmod,
  subosc, noise,
  phaser, phaserdepth, wob, wobdepth, duck, duckorbit, duckdepth, duckonset, duckattack, duckhold, duckrelease, bank,
  chord, anchor, mode, offset, dict, orbit, adsr, penv, pattack, pdecay, vowel, midi, midichan, midiport,
} = controls;
