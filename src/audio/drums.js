// Kit de batería y FX 100% sintetizado (no depende de internet ni de samples externos).
// Cada sonido se renderiza una vez con OfflineAudioContext y se guarda como AudioBuffer.

// PRNG determinista para que el kit suene igual siempre.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseBuffer(ctx, seconds, seed = 1, color = 'white') {
  const len = Math.max(1, Math.floor(seconds * ctx.sampleRate));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const r = mulberry32(seed);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = r() * 2 - 1;
    if (color === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    } else if (color === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return buf;
}

function env(param, t, points) {
  // points: [[tiempo, valor, 'lin'|'exp'], ...] relativos a t
  param.setValueAtTime(points[0][1], t + points[0][0]);
  for (const [dt, v, kind] of points.slice(1)) {
    if (kind === 'exp') param.exponentialRampToValueAtTime(Math.max(v, 1e-4), t + dt);
    else param.linearRampToValueAtTime(v, t + dt);
  }
}

function tanhCurve(drive) {
  const n = 2048;
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * drive) / norm;
  }
  return c;
}

// ---------------- recetas ----------------
function kick(ctx, out, t, { f0 = 200, f1 = 50, pitchTime = 0.06, decay = 0.4, drive = 1.5, click = 0.5, level = 1 }) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  env(osc.frequency, t, [[0, f0], [pitchTime, f1, 'exp'], [decay, f1 * 0.85, 'exp']]);
  const g = ctx.createGain();
  env(g.gain, t, [[0, 0], [0.002, level], [decay * 0.35, level * 0.6, 'exp'], [decay, 0.0001, 'exp']]);
  const sh = ctx.createWaveShaper();
  sh.curve = tanhCurve(drive);
  osc.connect(g).connect(sh).connect(out);
  osc.start(t);
  osc.stop(t + decay + 0.05);
  if (click > 0) {
    const nb = ctx.createBufferSource();
    nb.buffer = noiseBuffer(ctx, 0.02, 7);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const cg = ctx.createGain();
    env(cg.gain, t, [[0, click * level], [0.006, 0.0001, 'exp']]);
    nb.connect(hp).connect(cg).connect(out);
    nb.start(t);
  }
}

function snare(ctx, out, t, { tone = 200, toneDecay = 0.09, noiseDecay = 0.2, bp = 3000, bpq = 0.8, hp = 900, toneLevel = 0.75, noiseLevel = 1.1, level = 1, seed = 3 }) {
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  env(osc.frequency, t, [[0, tone * 1.6], [0.02, tone, 'exp']]);
  const og = ctx.createGain();
  env(og.gain, t, [[0, 0], [0.001, toneLevel * level], [toneDecay, 0.0001, 'exp']]);
  osc.connect(og).connect(out);
  osc.start(t);
  osc.stop(t + toneDecay + 0.05);
  const nb = ctx.createBufferSource();
  nb.buffer = noiseBuffer(ctx, noiseDecay + 0.1, seed);
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = bp;
  f1.Q.value = bpq;
  const f2 = ctx.createBiquadFilter();
  f2.type = 'highpass';
  f2.frequency.value = hp;
  const ng = ctx.createGain();
  env(ng.gain, t, [[0, 0], [0.001, noiseLevel * level], [noiseDecay, 0.0001, 'exp']]);
  nb.connect(f1).connect(f2).connect(ng).connect(out);
  nb.start(t);
}

function metallic(ctx, out, t, { base = 40, decay = 0.05, bp = 10000, hp = 7000, level = 0.5 }) {
  const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
  const mix = ctx.createGain();
  mix.gain.value = 1 / ratios.length;
  for (const r of ratios) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = base * r;
    o.connect(mix);
    o.start(t);
    o.stop(t + decay + 0.1);
  }
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = bp;
  const f2 = ctx.createBiquadFilter();
  f2.type = 'highpass';
  f2.frequency.value = hp;
  const g = ctx.createGain();
  env(g.gain, t, [[0, 0], [0.001, level], [decay, 0.0001, 'exp']]);
  mix.connect(f1).connect(f2).connect(g).connect(out);
}

function hat(ctx, out, t, { decay = 0.04, hp = 7000, lp = 16000, level = 0.5, seed = 11, metal = 0 }) {
  const nb = ctx.createBufferSource();
  nb.buffer = noiseBuffer(ctx, decay + 0.05, seed);
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const l = ctx.createBiquadFilter();
  l.type = 'lowpass';
  l.frequency.value = lp;
  const g = ctx.createGain();
  env(g.gain, t, [[0, 0], [0.001, level], [decay, 0.0001, 'exp']]);
  nb.connect(f).connect(l).connect(g).connect(out);
  nb.start(t);
  if (metal > 0) metallic(ctx, out, t, { decay, level: level * metal });
}

function clap(ctx, out, t, { decay = 0.18, bp = 1200, level = 1.4, seed = 21 }) {
  const nb = ctx.createBufferSource();
  nb.buffer = noiseBuffer(ctx, 0.5, seed);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = bp;
  f.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  for (let i = 0; i < 3; i++) {
    const tt = t + i * 0.011;
    g.gain.setValueAtTime(level, tt);
    g.gain.exponentialRampToValueAtTime(0.05, tt + 0.009);
  }
  const t3 = t + 0.033;
  g.gain.setValueAtTime(level, t3);
  g.gain.exponentialRampToValueAtTime(0.0001, t3 + decay);
  nb.connect(f).connect(g).connect(out);
  nb.start(t);
}

function tom(ctx, out, t, { f0 = 160, decay = 0.35, level = 0.8 }) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  env(o.frequency, t, [[0, f0 * 1.5], [0.05, f0, 'exp'], [decay, f0 * 0.8, 'exp']]);
  const g = ctx.createGain();
  env(g.gain, t, [[0, 0], [0.002, level], [decay, 0.0001, 'exp']]);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + decay + 0.05);
}

function tonal(ctx, out, t, { freqs = [540, 800], type = 'square', decay = 0.15, bp = 900, level = 0.4 }) {
  const mix = ctx.createGain();
  mix.gain.value = 1 / freqs.length;
  for (const f of freqs) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.connect(mix);
    o.start(t);
    o.stop(t + decay + 0.05);
  }
  const bf = ctx.createBiquadFilter();
  bf.type = 'bandpass';
  bf.frequency.value = bp;
  const g = ctx.createGain();
  env(g.gain, t, [[0, 0], [0.001, level], [decay, 0.0001, 'exp']]);
  mix.connect(bf).connect(g).connect(out);
}

function sweep(ctx, out, t, { seconds = 4, f0 = 200, f1 = 8000, up = true, level = 0.5, seed = 31 }) {
  const nb = ctx.createBufferSource();
  nb.buffer = noiseBuffer(ctx, seconds + 0.1, seed);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 2;
  env(f.frequency, t, [[0, up ? f0 : f1], [seconds, up ? f1 : f0, 'exp']]);
  const g = ctx.createGain();
  // sube desde -40 dB (audible desde el principio) hasta el nivel final
  if (up) env(g.gain, t, [[0, level * 0.01], [seconds * 0.95, level, 'exp'], [seconds, 0.0001, 'exp']]);
  else env(g.gain, t, [[0, level], [seconds, 0.0001, 'exp']]);
  nb.connect(f).connect(g).connect(out);
  nb.start(t);
}

function zap(ctx, out, t, { f0 = 2500, f1 = 80, decay = 0.18, type = 'sawtooth', level = 0.55 }) {
  const o = ctx.createOscillator();
  o.type = type;
  env(o.frequency, t, [[0, f0], [decay, f1, 'exp']]);
  const g = ctx.createGain();
  env(g.gain, t, [[0, level], [decay, 0.0001, 'exp']]);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + decay + 0.05);
}

function vinyl(ctx, out, t, { seconds = 4, level = 0.25, seed = 41 }) {
  const len = Math.floor(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const r = mulberry32(seed);
  for (let i = 0; i < len; i++) {
    let x = (r() * 2 - 1) * 0.04;
    if (r() < 0.0006) x += (r() * 2 - 1) * 0.9;
    d[i] = x;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 6000;
  const g = ctx.createGain();
  g.gain.value = level;
  src.connect(lp).connect(g).connect(out);
  src.start(t);
}

// ---------------- definición del kit ----------------
// [nombre, duración (s), [variantes...]] — cada variante es (ctx, out, t) => void
export const KIT = {
  bd: [0.8, [
    (c, o, t) => kick(c, o, t, { f0: 230, f1: 55, pitchTime: 0.045, decay: 0.24, drive: 1.8, click: 0.6 }),
    (c, o, t) => kick(c, o, t, { f0: 170, f1: 48, pitchTime: 0.07, decay: 0.38, drive: 1.3, click: 0.35 }),
    (c, o, t) => kick(c, o, t, { f0: 320, f1: 58, pitchTime: 0.035, decay: 0.22, drive: 4, click: 0.7 }),
    (c, o, t) => kick(c, o, t, { f0: 120, f1: 41, pitchTime: 0.1, decay: 0.75, drive: 1.3, click: 0.15 }),
    (c, o, t) => kick(c, o, t, { f0: 190, f1: 62, pitchTime: 0.03, decay: 0.18, drive: 2, click: 0.6 }),
    (c, o, t) => kick(c, o, t, { f0: 110, f1: 44, pitchTime: 0.07, decay: 0.34, drive: 1, click: 0.1 }),
  ]],
  sn: [0.6, [
    (c, o, t) => snare(c, o, t, { tone: 210, toneDecay: 0.08, noiseDecay: 0.2, bp: 3200, hp: 1000 }),
    (c, o, t) => snare(c, o, t, { tone: 180, toneDecay: 0.14, noiseDecay: 0.3, bp: 2200, hp: 600, toneLevel: 0.8 }),
    (c, o, t) => snare(c, o, t, { tone: 250, toneDecay: 0.06, noiseDecay: 0.12, bp: 5000, hp: 1500 }),
    (c, o, t) => {
      snare(c, o, t, { tone: 200, toneDecay: 0.07, noiseDecay: 0.16, bp: 2800, hp: 900, level: 0.8 });
      clap(c, o, t, { decay: 0.15, level: 0.6 });
    },
    (c, o, t) => snare(c, o, t, { tone: 320, toneDecay: 0.03, noiseDecay: 0.06, bp: 6000, hp: 2000, level: 0.8 }),
    (c, o, t) => snare(c, o, t, { tone: 190, toneDecay: 0.1, noiseDecay: 0.45, bp: 2500, hp: 700, noiseLevel: 0.9 }),
  ]],
  hh: [0.2, [
    (c, o, t) => hat(c, o, t, { decay: 0.04 }),
    (c, o, t) => hat(c, o, t, { decay: 0.05, metal: 0.8, level: 0.4 }),
    (c, o, t) => hat(c, o, t, { decay: 0.022, hp: 9000 }),
    (c, o, t) => hat(c, o, t, { decay: 0.08, lp: 11000, level: 0.35 }),
  ]],
  oh: [0.8, [
    (c, o, t) => hat(c, o, t, { decay: 0.35, metal: 0.8, level: 0.4 }),
    (c, o, t) => hat(c, o, t, { decay: 0.5, level: 0.35 }),
    (c, o, t) => hat(c, o, t, { decay: 0.2, metal: 0.5, level: 0.45 }),
  ]],
  cp: [0.5, [
    (c, o, t) => clap(c, o, t, {}),
    (c, o, t) => clap(c, o, t, { decay: 0.3, bp: 1000 }),
    (c, o, t) => clap(c, o, t, { decay: 0.1, bp: 1800, level: 1.3 }),
  ]],
  rim: [0.2, [
    (c, o, t) => tonal(c, o, t, { freqs: [820, 1650], type: 'triangle', decay: 0.04, bp: 1700, level: 0.7 }),
    (c, o, t) => tonal(c, o, t, { freqs: [500, 1200], type: 'square', decay: 0.03, bp: 1500, level: 0.5 }),
  ]],
  rd: [1.6, [
    (c, o, t) => {
      metallic(c, o, t, { base: 60, decay: 1.2, bp: 8000, hp: 4000, level: 1.2 });
      hat(c, o, t, { decay: 0.9, hp: 6000, lp: 14000, level: 0.18, seed: 81 });
    },
    (c, o, t) => {
      metallic(c, o, t, { base: 75, decay: 0.7, bp: 9000, hp: 5000, level: 1.1 });
      hat(c, o, t, { decay: 0.5, hp: 7000, lp: 15000, level: 0.15, seed: 82 });
    },
  ]],
  cr: [2.4, [
    (c, o, t) => {
      hat(c, o, t, { decay: 1.8, hp: 3500, level: 0.4, seed: 51 });
      metallic(c, o, t, { base: 50, decay: 1.4, bp: 6000, hp: 3000, level: 0.2 });
    },
    (c, o, t) => hat(c, o, t, { decay: 1.2, hp: 5000, level: 0.35, seed: 52 }),
  ]],
  tom: [0.6, [
    (c, o, t) => tom(c, o, t, { f0: 110 }),
    (c, o, t) => tom(c, o, t, { f0: 160 }),
    (c, o, t) => tom(c, o, t, { f0: 230, decay: 0.25 }),
  ]],
  sh: [0.2, [
    (c, o, t) => hat(c, o, t, { decay: 0.07, hp: 5000, lp: 9000, level: 0.5, seed: 61 }),
    (c, o, t) => hat(c, o, t, { decay: 0.045, hp: 6000, lp: 12000, level: 0.5, seed: 62 }),
  ]],
  cb: [0.4, [(c, o, t) => tonal(c, o, t, { freqs: [540, 800], decay: 0.2, bp: 900 })]],
  tb: [0.4, [
    (c, o, t) => {
      hat(c, o, t, { decay: 0.16, hp: 6000, lp: 15000, level: 0.35, seed: 91 });
      metallic(c, o, t, { base: 110, decay: 0.14, bp: 9000, hp: 6000, level: 0.6 });
    },
    (c, o, t) => hat(c, o, t, { decay: 0.08, hp: 7000, lp: 15000, level: 0.45, seed: 92 }),
  ]],
  perc: [0.4, [
    (c, o, t) => tonal(c, o, t, { freqs: [1200], type: 'sine', decay: 0.06, bp: 1200, level: 0.6 }),
    (c, o, t) => tonal(c, o, t, { freqs: [700, 1050], type: 'triangle', decay: 0.09, bp: 1000, level: 0.6 }),
    (c, o, t) => zap(c, o, t, { f0: 1800, f1: 300, decay: 0.08, type: 'sine', level: 0.5 }),
  ]],
  riser: [4.2, [
    (c, o, t) => sweep(c, o, t, { seconds: 4, up: true }),
    (c, o, t) => sweep(c, o, t, { seconds: 2, up: true, f0: 400, f1: 10000, seed: 32 }),
  ]],
  down: [2.2, [
    (c, o, t) => sweep(c, o, t, { seconds: 2, up: false }),
    (c, o, t) => sweep(c, o, t, { seconds: 1, up: false, f0: 150, f1: 6000, seed: 33 }),
  ]],
  impact: [2.6, [
    (c, o, t) => {
      kick(c, o, t, { f0: 120, f1: 30, pitchTime: 0.3, decay: 2.4, drive: 1.5, click: 0.8 });
      hat(c, o, t, { decay: 1.2, hp: 1500, level: 0.3, seed: 71 });
    },
    (c, o, t) => kick(c, o, t, { f0: 90, f1: 28, pitchTime: 0.5, decay: 2, drive: 2.5, click: 0.3 }),
  ]],
  zap: [0.3, [
    (c, o, t) => zap(c, o, t, {}),
    (c, o, t) => zap(c, o, t, { f0: 4000, f1: 200, decay: 0.1, type: 'square' }),
  ]],
  vinyl: [4, [(c, o, t) => vinyl(c, o, t, {})]],
};

// Alias: incluye los nombres estándar de Strudel/tidal-drum-machines (sd = caja, tb = pandereta...)
export const ALIASES = { sd: 'sn', kick: 'bd', snare: 'sn', hat: 'hh', hihat: 'hh', openhat: 'oh', clap: 'cp', ride: 'rd', crash: 'cr', shaker: 'sh', cowbell: 'cb', rimshot: 'rim', tambourine: 'tb', misc: 'perc' };
export const SOUND_NAMES = [...Object.keys(KIT), 'brk', ...Object.keys(ALIASES), 'lt', 'mt', 'ht'];

// Breaks sintetizados (un compás de 4 tiempos, 16 semicorcheas). Pensados para .slice/.splice/.fit.
// Cada golpe: [paso, sonido, variante, ganancia]
export const BREAKS = [
  // 0: break "funky" con fantasmas (estilo clásico de jungle)
  [[0, 'bd', 4, 0.6], [2, 'bd', 4, 0.45], [4, 'sn', 2, 1], [7, 'sn', 2, 0.4], [9, 'sn', 2, 0.45], [10, 'bd', 4, 0.55],
   [11, 'bd', 4, 0.4], [12, 'sn', 2, 1], [15, 'sn', 2, 0.4], ...[0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, 'hh', 0, 0.6]),
   ...[1, 3, 5, 9, 11, 13].map((s) => [s, 'hh', 2, 0.3])],
  // 1: break "think" (semicorcheas abiertas)
  [[0, 'bd', 0, 0.6], [6, 'bd', 0, 0.45], [10, 'bd', 0, 0.55], [4, 'sn', 0, 1], [12, 'sn', 0, 1], [14, 'sn', 0, 0.4],
   ...Array.from({ length: 16 }, (_, s) => [s, 'hh', 1, s % 4 === 2 ? 0.7 : 0.35]), [8, 'oh', 2, 0.4]],
  // 2: roller (dos pasos con shaker)
  [[0, 'bd', 0, 0.6], [10, 'bd', 0, 0.55], [4, 'sn', 0, 1], [12, 'sn', 0, 1], [7, 'sn', 4, 0.35], [9, 'sn', 4, 0.35],
   [15, 'sn', 4, 0.35], ...Array.from({ length: 16 }, (_, s) => [s, 'sh', 1, s % 2 ? 0.4 : 0.7])],
  // 3: halftime pesado
  [[0, 'bd', 2, 0.65], [3, 'bd', 2, 0.45], [8, 'sn', 3, 1], [11, 'bd', 2, 0.5], [14, 'sn', 4, 0.35],
   ...[0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, 'hh', 1, 0.45])],
];
export const BREAK_BPM = 170;

async function renderOne(sampleRate, seconds, fn) {
  const len = Math.ceil(seconds * sampleRate);
  const ctx = new OfflineAudioContext(1, len, sampleRate);
  fn(ctx, ctx.destination, 0);
  return ctx.startRendering();
}

export async function buildKit(sampleRate = 48000) {
  const kit = new Map();
  const jobs = [];
  for (const [name, [seconds, variants]] of Object.entries(KIT)) {
    kit.set(name, new Array(variants.length));
    variants.forEach((fn, i) => {
      jobs.push(renderOne(sampleRate, seconds, fn).then((b) => (kit.get(name)[i] = b)));
    });
  }
  await Promise.all(jobs);
  // Breaks: se montan con los golpes ya renderizados.
  const stepDur = 60 / BREAK_BPM / 4;
  const barDur = stepDur * 16;
  const breaks = await Promise.all(
    BREAKS.map((hits, bi) => {
      const len = Math.ceil(barDur * sampleRate);
      const ctx = new OfflineAudioContext(1, len, sampleRate);
      const r = mulberry32(100 + bi);
      for (const [step, s, v, g] of hits) {
        const src = ctx.createBufferSource();
        src.buffer = kit.get(s)[v];
        const gn = ctx.createGain();
        gn.gain.value = g * (0.9 + r() * 0.2);
        src.connect(gn).connect(ctx.destination);
        const swing = step % 2 === 1 ? stepDur * 0.08 : 0;
        src.start(step * stepDur + swing + r() * 0.003);
      }
      return ctx.startRendering();
    }),
  );
  kit.set('brk', breaks);
  for (const [alias, target] of Object.entries(ALIASES)) kit.set(alias, kit.get(target));
  const toms = kit.get('tom');
  kit.set('lt', [toms[0]]);
  kit.set('mt', [toms[1]]);
  kit.set('ht', [toms[2]]);
  return kit;
}

export { noiseBuffer, mulberry32 };
