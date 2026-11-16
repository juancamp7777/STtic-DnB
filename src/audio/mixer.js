// Mezclador: un bus por pista (fader, mute/solo, sidechain, medidor), envíos a
// reverb y delay, y cadena master con compresor + limitador + clipper suave.
import { mulberry32 } from './drums.js';
import { REVERB_SIZES } from './params.js';

function makeImpulse(ctx, seconds, seed) {
  const len = Math.floor(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const r = mulberry32(seed + ch * 17);
    let lp = 0;
    const pre = Math.floor(0.012 * ctx.sampleRate);
    for (let i = 0; i < len; i++) {
      if (i < pre) {
        d[i] = 0;
        continue;
      }
      const t = (i - pre) / ctx.sampleRate;
      const decay = Math.exp((-6.9 * t) / seconds);
      // ruido filtrado (más oscuro al final)
      const damp = 0.25 + 0.7 * (t / seconds);
      lp = lp + (1 - damp) * ((r() * 2 - 1) - lp);
      d[i] = lp * decay;
    }
  }
  return buf;
}

function softClipCurve() {
  const n = 4096;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    // lineal hasta 0.8, luego satura suavemente hacia 0.98 (nunca pasa de 1)
    const a = Math.abs(x);
    const y = a < 0.8 ? a : 0.8 + 0.18 * Math.tanh((a - 0.8) / 0.18);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

export class Mixer {
  // raw: sin compresor/limitador/clipper en el master (stems: cada pista tal cual sale de su bus)
  constructor(ctx, destination = ctx.destination, { raw = false } = {}) {
    this.ctx = ctx;
    this.buses = new Map();
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    // filtro anti-DC (protege al limitador de offsets, p. ej. FM con índice alto)
    this.dcblock = ctx.createBiquadFilter();
    this.dcblock.type = 'highpass';
    this.dcblock.frequency.value = 16;
    this.dcblock.Q.value = -3.0103; // Q en dB para pasa-altos: Butterworth, sin pico
    this.glue = ctx.createDynamicsCompressor();
    this.glue.threshold.value = -14;
    this.glue.knee.value = 8;
    this.glue.ratio.value = 2.5;
    this.glue.attack.value = 0.01;
    this.glue.release.value = 0.15;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.08;
    this.clipper = ctx.createWaveShaper();
    this.clipper.curve = softClipCurve();
    this.out = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    if (raw) this.master.connect(this.dcblock).connect(this.out);
    else this.master.connect(this.dcblock).connect(this.glue).connect(this.limiter).connect(this.clipper).connect(this.out);
    this.out.connect(this.analyser);
    this.out.connect(destination);
    this.reverbs = new Map();
    this.solo = new Set();
    this.orbits = new Map(); // orbit -> pistas que han sonado en ella (para duckorbit numérico)
  }

  reverbIndex(size) {
    return Math.min(REVERB_SIZES.length - 1, Math.floor(size * REVERB_SIZES.length));
  }

  reverbInput(size) {
    const idx = this.reverbIndex(size);
    let rv = this.reverbs.get(idx);
    if (!rv) {
      const input = this.ctx.createGain();
      const conv = this.ctx.createConvolver();
      conv.normalize = true;
      conv.buffer = makeImpulse(this.ctx, REVERB_SIZES[idx], 900 + idx);
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 180; // la reverb no ensucia los graves
      const ret = this.ctx.createGain();
      ret.gain.value = 0.6;
      input.connect(hp).connect(conv).connect(ret).connect(this.master);
      rv = { input };
      this.reverbs.set(idx, rv);
    }
    return rv.input;
  }

  bus(name) {
    let b = this.buses.get(name);
    if (b) return b;
    const ctx = this.ctx;
    const input = ctx.createGain();
    const duck = ctx.createGain();
    const fader = ctx.createGain();
    const mute = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    input.connect(duck).connect(fader).connect(mute);
    mute.connect(analyser);
    mute.connect(this.master);
    // delay por pista, sincronizado al tempo. El filtro de amortiguación es Butterworth (Q en dB = -3):
    // su ganancia nunca pasa de 1, así que con feedback < 1 la realimentación no se dispara.
    const delayIn = ctx.createGain();
    const delay = ctx.createDelay(4);
    delay.delayTime.value = 0.25;
    const fb = ctx.createGain();
    fb.gain.value = 0.45;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 4500;
    damp.Q.value = -3.0103;
    delayIn.connect(delay);
    delay.connect(damp).connect(fb).connect(delay);
    damp.connect(fader); // el retorno pasa por el fader y el mute de la pista
    b = { name, input, duck, fader, mute, analyser, delayIn, delay, fb, muted: false, volume: 1, cuts: new Map(), sends: new Map() };
    // envío a reverb por pista y tamaño, controlado por el fader y el mute
    b.send = (size) => {
      const idx = this.reverbIndex(size);
      let g = b.sends.get(idx);
      if (!g) {
        g = ctx.createGain();
        g.gain.value = b.volume * (this.isAudible(name) ? 1 : 0);
        g.connect(this.reverbInput(size));
        b.sends.set(idx, g);
      }
      return g;
    };
    this.buses.set(name, b);
    this.applyMutes();
    return b;
  }

  setVolume(name, v) {
    const b = this.bus(name);
    b.volume = v;
    b.fader.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    const wet = v * (this.isAudible(name) ? 1 : 0);
    for (const g of b.sends.values()) g.gain.setTargetAtTime(wet, this.ctx.currentTime, 0.02);
  }

  // Quita del solo las pistas que ya no existen (si no, todo quedaría en silencio sin botón para deshacerlo).
  pruneSolo(names) {
    const keep = new Set(names);
    let changed = false;
    for (const s of [...this.solo]) {
      if (!keep.has(s)) {
        this.solo.delete(s);
        changed = true;
      }
    }
    if (changed) this.applyMutes();
    return changed;
  }

  noteOrbit(orbit, track) {
    if (orbit == null) return;
    let set = this.orbits.get(orbit);
    if (!set) this.orbits.set(orbit, (set = new Set()));
    set.add(track);
  }

  // Destinos de sidechain: nombres de pista o números de orbit (como duckorbit en Strudel)
  resolveTargets(targets) {
    const out = new Set();
    for (const t of targets) {
      if (/^\d+$/.test(t)) for (const name of this.orbits.get(Number(t)) || []) out.add(name);
      else out.add(t);
    }
    return [...out];
  }
  setMuted(name, muted) {
    this.bus(name).muted = muted;
    this.applyMutes();
  }
  setSolo(name, on) {
    if (on) this.solo.add(name);
    else this.solo.delete(name);
    this.applyMutes();
  }
  isAudible(name) {
    const b = this.buses.get(name);
    if (b && b.muted) return false;
    return this.solo.size === 0 || this.solo.has(name);
  }
  applyMutes() {
    for (const b of this.buses.values()) {
      const target = this.isAudible(b.name) ? 1 : 0;
      b.mute.gain.setTargetAtTime(target, this.ctx.currentTime, 0.01);
      for (const g of b.sends.values()) g.gain.setTargetAtTime(target * b.volume, this.ctx.currentTime, 0.01);
    }
  }

  // Sidechain: dip rápido (onset), se mantiene (hold) y vuelve al volumen (recover ≈ tiempo hasta ~98%).
  duck(targets, t, depth, onset, recover, hold = 0.03) {
    for (const name of this.resolveTargets(targets)) {
      const b = this.buses.get(name);
      if (!b) continue;
      const g = b.duck.gain;
      g.cancelScheduledValues(t);
      g.setTargetAtTime(1 - depth, t, onset / 3);
      g.setTargetAtTime(1, t + onset + hold, recover / 4);
    }
  }

  setDelay(bus, t, time, feedback) {
    bus.delay.delayTime.setValueAtTime(time, t);
    bus.fb.gain.setValueAtTime(feedback, t);
  }

  level(name) {
    const b = this.buses.get(name);
    return b ? rms(b.analyser) : 0;
  }
  masterLevel() {
    return rms(this.analyser);
  }
}

const tmp = new Float32Array(2048);
function rms(an) {
  const n = an.fftSize;
  const arr = n <= tmp.length ? tmp.subarray(0, n) : new Float32Array(n);
  an.getFloatTimeDomainData(arr);
  let s = 0;
  for (let i = 0; i < n; i++) s += arr[i] * arr[i];
  return Math.sqrt(s / n);
}
