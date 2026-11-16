// Resolución pura de parámetros de una voz (sin Web Audio): defaults, alias y
// límites seguros. Separado del motor para poder testearlo a fondo en Node.
import { midiToFreq, noteToMidi } from '../core/theory.js';

export const SYNTHS = new Set([
  'sine', 'sawtooth', 'saw', 'square', 'triangle', 'tri', 'supersaw', 'reese', 'sub', 'fm', 'bell',
  'pluck', 'white', 'pink', 'brown', 'noise', 'b808', 'organ',
]);

// Formantes (Hz, ganancia relativa) para .vowel()
export const VOWELS = {
  a: [[800, 1], [1150, 0.5], [2900, 0.25]],
  e: [[350, 1], [2000, 0.5], [2800, 0.25]],
  i: [[270, 1], [2140, 0.4], [2950, 0.25]],
  o: [[450, 1], [800, 0.6], [2830, 0.15]],
  u: [[325, 1], [700, 0.5], [2700, 0.1]],
};

// Nota de referencia de los samples: como en Strudel, note("c2") (36) toca el sample a su altura original.
export const SAMPLE_BASE_NOTE = 36;
// Frecuencia mínima a la que se añaden capas de sub-octava (por debajo sólo ensucian y gastan headroom).
export const MIN_SUB_LAYER_HZ = 30;
// Reverbs disponibles (segundos de cola). size 0–1 elige una; size > 1 = segundos, como roomsize en Strudel.
export const REVERB_SIZES = [0.6, 1.4, 2.8, 5.5];
export function sizeForSeconds(sec) {
  let best = 0;
  for (let i = 1; i < REVERB_SIZES.length; i++) {
    if (Math.abs(Math.log(sec / REVERB_SIZES[i])) < Math.abs(Math.log(sec / REVERB_SIZES[best]))) best = i;
  }
  return (best + 0.5) / REVERB_SIZES.length; // centro del tramo de esa reverb
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : lo));
const safeMidi = (x, d) => {
  try {
    const m = typeof x === 'string' ? noteToMidi(x) : Number(x);
    return Number.isFinite(m) ? m : d;
  } catch {
    return d;
  }
};
const finite = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);

// Nivel base por tipo de oscilador para que todos suenen parecido de fuerte.
const LEVEL = {
  // sub/sine/b808 más bajos: una senoide sostenida acapara el limitador y aplasta los medios
  sine: 0.3, sub: 0.3, triangle: 0.4, tri: 0.4, sawtooth: 0.22, saw: 0.22, square: 0.18, supersaw: 0.16,
  reese: 0.2, fm: 0.35, bell: 0.3, pluck: 0.45, white: 0.12, pink: 0.18, brown: 0.3, noise: 0.12, b808: 0.38, organ: 0.28,
};

export function resolveVoice(v, { duration = 0.25, cps = 0.725, isSample = false } = {}) {
  const value = v && typeof v === 'object' ? v : { note: v };
  let s = value.s;
  if (s == null && (value.note != null || value.freq != null)) s = 'triangle';
  if (s == null) return null;
  s = String(s);
  const synth = SYNTHS.has(s) && !isSample;

  let freq = null;
  if (synth) {
    if (value.freq != null) freq = finite(Number(value.freq), 220);
    else freq = midiToFreq(clamp(safeMidi(value.note ?? value.n ?? 48, 48), -24, 160));
    freq = clamp(freq, 1, 20000);
  }

  const has = (k) => value[k] != null && value[k] !== '' && Number.isFinite(Number(value[k]));
  const get = (k, d) => (has(k) ? Number(value[k]) : d);
  const str = (k) => (value[k] != null ? String(value[k]) : null);

  const clip = get('clip', 1);
  const dur = Math.max(0.005, finite(duration, 0.25) * Math.max(0, clip));

  // Envolvente: si se da decay sin sustain, el sonido decae a 0 (pluck).
  const presets = {
    pluck: { decay: 0.25, sustain: 0 },
    b808: { decay: 0.9, sustain: 0 },
    bell: { decay: 1.4, sustain: 0 },
  };
  const pre = presets[s] || {};
  const attack = clamp(get('attack', synth ? 0.003 : 0.001), 0.0005, 10);
  const decay = clamp(get('decay', pre.decay ?? 0), 0, 20);
  const sustain = clamp(get('sustain', has('decay') || pre.decay != null ? (pre.sustain ?? 0) : 1), 0, 1);
  const release = clamp(get('release', synth ? 0.02 : 0.005), 0.001, 20);
  // los samples sólo usan ADSR si el código lo pide (si no, suenan enteros con micro-fundidos)
  const env = has('attack') || has('decay') || has('sustain') || has('release');

  const gain = clamp(get('gain', 1), 0, 4) * clamp(get('velocity', 1), 0, 4) * clamp(get('postgain', 1), 0, 8);
  const level = synth ? (LEVEL[s] ?? 0.25) : 1;
  // ftype como Strudel: 0/12db, 1/ladder, 2/24db (ladder y 24db usan dos etapas)
  const ftRaw = str('ftype');
  const ftype = { 0: '12db', 1: 'ladder', 2: '24db', 12: '12db', 24: '24db' }[ftRaw] ?? ftRaw;

  const out = {
    s,
    n: Math.max(0, Math.floor(get('n', 0))),
    synth,
    freq,
    dur,
    hold: !synth && !has('clip') && !value.fit ? null : dur,
    env,
    attack,
    decay,
    sustain,
    release,
    peak: gain * level,
    pan: clamp(get('pan', 0.5), 0, 1),
    lpf: has('lpf') ? clamp(get('lpf', 20000), 20, 20000) : null,
    lpq: clamp(get('lpq', 1), 0.0001, 50),
    hpf: has('hpf') ? clamp(get('hpf', 20), 20, 20000) : null,
    hpq: clamp(get('hpq', 1), 0.0001, 50),
    bpf: has('bpf') ? clamp(get('bpf', 1000), 20, 20000) : null,
    bpq: clamp(get('bpq', 1), 0.0001, 50),
    ftype: ftype === '24db' || ftype === 'ladder' ? '24db' : '12db',
    lpenv: clamp(get('lpenv', 0), -10, 10),
    hpenv: clamp(get('hpenv', 0), -10, 10),
    bpenv: clamp(get('bpenv', 0), -10, 10),
    lpattack: clamp(get('lpattack', 0.005), 0.0005, 10),
    lpdecay: clamp(get('lpdecay', 0.15), 0, 10),
    lpsustain: clamp(get('lpsustain', 0), 0, 1),
    lprelease: clamp(get('lprelease', 0.1), 0.001, 10),
    shape: has('shape') ? clamp(get('shape', 0), 0, 0.99) : 0,
    shapevol: clamp(get('shapevol', 1), 0, 4),
    distort: has('distort') ? clamp(get('distort', 0), 0, 20) : s === 'b808' ? 0.4 : 0,
    distortvol: clamp(get('distortvol', 1), 0, 4),
    crush: has('crush') ? clamp(get('crush', 16), 1, 16) : null,
    coarse: has('coarse') ? Math.round(clamp(get('coarse', 1), 1, 64)) : 1,
    room: clamp(get('room', 0), 0, 1),
    // size: 0–1 es la escala de Pulso; valores > 1 se entienden como segundos de cola (como en Strudel)
    size: (() => {
      const sz = get('size', 0.5);
      return sz > 1 ? sizeForSeconds(Math.min(sz, 20)) : clamp(sz, 0, 1);
    })(),
    delay: clamp(get('delay', 0), 0, 1),
    delaytime: has('delaytime')
      ? clamp(get('delaytime', 0.25), 0.001, 4)
      : clamp(get('delaysync', 3 / 16) / Math.max(0.01, cps), 0.001, 4),
    // < 0.9: con el filtro de amortiguación (sin resonancia) la realimentación nunca se dispara
    delayfeedback: clamp(get('delayfeedback', 0.45), 0, 0.9),
    speed: clamp(get('speed', 1), -16, 16),
    begin: clamp(get('begin', 0), 0, 1),
    end: clamp(get('end', 1), 0, 1),
    cut: has('cut') ? Math.round(get('cut', 0)) : null,
    accelerate: clamp(get('accelerate', 0), -8, 8),
    fit: !!value.fit,
    note: value.note != null ? clamp(safeMidi(value.note, 48), -24, 160) : null,
    fm: clamp(get('fm', s === 'bell' ? 4 : 2), 0, 50),
    fmh: clamp(get('fmh', s === 'bell' ? 3.5 : 1), 0.01, 32),
    fmattack: has('fmattack') ? clamp(get('fmattack', 0.001), 0.0005, 10) : null,
    fmdecay: has('fmdecay') ? clamp(get('fmdecay', 0.3), 0.001, 10) : null,
    fmsustain: clamp(get('fmsustain', has('fmdecay') ? 0 : 1), 0, 1),
    fmexp: str('fmenv') === 'exp',
    detune: clamp(get('detune', s === 'reese' ? 0.15 : s === 'supersaw' ? 0.25 : 0), 0, 12),
    unison: Math.round(clamp(get('unison', 7), 1, 16)),
    spread: clamp(get('spread', 0.6), 0, 1),
    vib: clamp(get('vib', 0), 0, 50),
    vibmod: clamp(get('vibmod', 0.15), 0, 24),
    subosc: clamp(get('subosc', 0), 0, 2),
    noise: clamp(get('noise', 0), 0, 2),
    phaser: clamp(get('phaser', 0), 0, 40),
    phaserdepth: clamp(get('phaserdepth', 0.75), 0, 1),
    wob: clamp(get('wob', 0), 0, 64),
    wobdepth: clamp(get('wobdepth', 2), 0, 8),
    // sidechain: destinos = nombres de pista o números de orbit ("2", "bass:pads")
    duck: value.duck != null ? String(value.duck).split(/[:\s,]+/).filter(Boolean) : null,
    duckdepth: clamp(get('duckdepth', 0.7), 0, 1),
    // como en Strudel: duckonset = bajada, duckattack = vuelta al volumen (duckrelease es alias)
    duckonset: clamp(get('duckonset', 0.004), 0.0005, 1),
    duckhold: clamp(get('duckhold', 0.03), 0, 2),
    duckrecover: clamp(get('duckattack', get('duckrelease', 0.18)), 0.005, 4),
    orbit: has('orbit') ? Math.round(get('orbit', 1)) : null,
    bank: value.bank != null ? String(value.bank) : null,
    // envolvente de tono: arranca penv semitonos arriba/abajo y vuelve en pdecay segundos
    penv: clamp(get('penv', 0), -48, 48),
    pattack: clamp(get('pattack', 0), 0, 4),
    pdecay: clamp(get('pdecay', 0.06), 0.001, 8),
    vowel: VOWELS[String(value.vowel ?? '').toLowerCase()] ? String(value.vowel).toLowerCase() : null,
    // MIDI sólo con .midi() o midiport (midichan solo no desvía el sonido)
    midi: value.midi != null || value.midiport != null ? String(value.midiport ?? value.midi ?? 'default') : null,
    midichan: Math.round(clamp(get('midichan', 1), 1, 16)),
    // velocidad MIDI como Strudel: gain × velocity (0.9 por defecto) × postgain, sin la tabla de niveles internos
    midivel: Math.round(clamp(127 * clamp(get('gain', 1), 0, 4) * clamp(get('velocity', 0.9), 0, 4) * clamp(get('postgain', 1), 0, 8), 1, 127)),
  };
  if (out.end <= out.begin) {
    // tramo vacío o invertido: se garantiza un tramo mínimo dentro de [0, 1]
    if (out.begin > 0.999) out.begin = 0.999;
    out.end = Math.min(1, out.begin + 0.001);
  }
  if (out.wob > 0 && out.lpf === null) out.lpf = 500;
  return out;
}

// Valor de una envolvente (lista de [tiempo, valor, 'set' | 'lin'] en el orden en que se programó) en el instante t,
// con la semántica de AudioParam: 'set' salta al valor, 'lin' es una rampa lineal desde el punto anterior.
// Lo usan los grupos de corte en navegadores sin cancelAndHoldAtTime.
export function envelopeValueAt(points, t) {
  let v = 0;
  let tPrev = null;
  // como AudioParam: los eventos van por tiempo; a igual tiempo, en el orden en que se programaron (orden estable)
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  for (const [pt, pv, kind] of sorted) {
    if (pt > t) {
      if (kind === 'lin' && tPrev !== null && pt > tPrev) return v + (pv - v) * ((t - tPrev) / (pt - tPrev));
      return tPrev === null ? 0 : v;
    }
    v = pv;
    tPrev = pt;
  }
  return v;
}

// Velocidad de reproducción de un sample según los parámetros (fit estira al evento).
// baseNote: nota original del sample (36 por defecto; en mapas por nota, la de la clave elegida).
export function sampleRate(p, bufferDuration, baseNote = SAMPLE_BASE_NOTE) {
  let rate = Math.abs(p.speed) || 1;
  if (p.note != null) rate *= 2 ** ((p.note - baseNote) / 12);
  if (p.fit) {
    const sliceDur = (p.end - p.begin) * bufferDuration;
    rate = Math.max(0.0625, Math.min(16, sliceDur / p.dur));
  }
  return Math.max(1 / 64, Math.min(64, Number.isFinite(rate) ? rate : 1));
}
