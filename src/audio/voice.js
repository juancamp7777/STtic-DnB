// Construye y programa el grafo de audio de una voz (synth o sample).
import { sampleRate, VOWELS, SAMPLE_BASE_NOTE, MIN_SUB_LAYER_HZ, envelopeValueAt } from './params.js';
import { noiseBuffer } from './drums.js';

// Envuelve un AudioParam y apunta cada punto programado (para saber su valor en cualquier instante).
function recordParam(param) {
  const points = [];
  return {
    points,
    setValueAtTime(v, t) {
      points.push([t, v, 'set']);
      param.setValueAtTime(v, t);
    },
    linearRampToValueAtTime(v, t) {
      points.push([t, v, 'lin']);
      param.linearRampToValueAtTime(v, t);
    },
  };
}

const curveCache = new Map();
function curve(kind, amount) {
  const key = `${kind}:${Math.round(amount * 100)}`;
  let c = curveCache.get(key);
  if (c) return c;
  const n = 2048;
  c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    if (kind === 'shape') {
      const k = (2 * amount) / (1 - amount);
      c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    } else if (kind === 'distort') {
      const d = 1 + amount * 3;
      c[i] = Math.tanh(x * d) / Math.tanh(d);
    } else {
      const levels = 2 ** (amount - 1);
      c[i] = Math.round(x * levels) / levels;
    }
  }
  curveCache.set(key, c);
  return c;
}

const noiseCache = new WeakMap();
function noise(ctx, color) {
  let m = noiseCache.get(ctx);
  if (!m) noiseCache.set(ctx, (m = {}));
  if (!m[color]) m[color] = noiseBuffer(ctx, 2, 5 + color.length, color);
  return m[color];
}

const reversedCache = new WeakMap();
function reversed(buf) {
  let r = reversedCache.get(buf);
  if (r) return r;
  r = new AudioBuffer({ length: buf.length, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch);
    const dst = r.getChannelData(ch);
    for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
  }
  reversedCache.set(buf, r);
  return r;
}

// Procesador de "coarse" (reducción de frecuencia de muestreo, como en Strudel/Tidal).
export const WORKLET_SOURCE = `
class PulsoCoarse extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'factor', defaultValue: 1, minValue: 1, maxValue: 64 }]; }
  constructor() { super(); this.held = []; this.count = 0; }
  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return false;
    const f = Math.max(1, Math.round(params.factor[0]));
    let c = this.count;
    for (let ch = 0; ch < output.length; ch++) {
      const inp = input[ch] || input[0];
      const out = output[ch];
      let h = this.held[ch] || 0;
      c = this.count;
      for (let i = 0; i < out.length; i++) {
        if (c % f === 0) h = inp ? inp[i] : 0;
        out[i] = h;
        c++;
      }
      this.held[ch] = h;
    }
    this.count = c;
    return true;
  }
}
registerProcessor('pulso-coarse', PulsoCoarse);
`;

// Programa ADSR sobre un AudioParam. Devuelve el instante en que termina.
export function scheduleADSR(param, start, holdEnd, { attack, decay, sustain, release }, peak) {
  const a = Math.max(0.0005, attack);
  const hold = Math.max(start + 0.001, holdEnd);
  param.setValueAtTime(0, start);
  if (hold <= start + a) {
    param.linearRampToValueAtTime(peak * ((hold - start) / a), hold);
  } else {
    param.linearRampToValueAtTime(peak, start + a);
    const sus = peak * sustain;
    if (decay > 0) {
      const dEnd = start + a + decay;
      if (hold <= dEnd) {
        param.linearRampToValueAtTime(peak + (sus - peak) * ((hold - start - a) / decay), hold);
      } else {
        param.linearRampToValueAtTime(sus, dEnd);
        param.setValueAtTime(sus, hold);
      }
    } else {
      // la rampa a sustain nunca termina después del final de la nota (si no, los eventos quedarían
      // fuera de orden y tras el release el volumen volvería a subir a sustain: una cola fantasma)
      if (sus !== peak) param.linearRampToValueAtTime(sus, Math.min(start + a + 0.005, hold));
      param.setValueAtTime(sus, hold);
    }
  }
  const end = hold + release;
  param.linearRampToValueAtTime(0, end);
  return end;
}

// Envolvente de un filtro (frecuencia base * 2^env en el ataque, vuelve a base * 2^(env*sustain))
function filterEnv(param, base, amount, p, start) {
  if (!amount) return;
  const clampF = (f) => Math.min(20000, Math.max(20, f));
  param.setValueAtTime(clampF(base), start);
  param.exponentialRampToValueAtTime(clampF(base * 2 ** amount), start + p.lpattack);
  param.exponentialRampToValueAtTime(clampF(base * 2 ** (amount * p.lpsustain)), start + p.lpattack + Math.max(0.001, p.lpdecay));
}

function oscillators(ctx, p, start, stopAt, dest) {
  const nodes = [];
  const osc = (type, freq, detuneCents = 0, gain = 1, target = dest) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detuneCents;
    let node = o;
    if (gain !== 1) {
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g);
      node = g;
    }
    node.connect(target);
    o.start(start);
    o.stop(stopAt);
    nodes.push(o);
    return o;
  };
  const f = p.freq;
  const subOk = f / 2 >= MIN_SUB_LAYER_HZ; // no añadir capas de sub-octava por debajo de ~30 Hz
  switch (p.s) {
    case 'sine':
    case 'sub':
      osc('sine', f);
      break;
    case 'saw':
    case 'sawtooth':
      osc('sawtooth', f);
      break;
    case 'square':
      osc('square', f);
      break;
    case 'tri':
    case 'triangle':
      osc('triangle', f);
      break;
    case 'organ':
      osc('sine', f, 0, 0.6);
      osc('sine', f * 2, 0, 0.3);
      osc('sine', f * 3, 0, 0.2);
      osc('sine', f * 4, 0, 0.1);
      break;
    case 'pluck':
      osc('sawtooth', f, 0, 0.6);
      osc('triangle', f * 2, 3, 0.4);
      break;
    case 'reese': {
      const d = p.detune * 50;
      osc('sawtooth', f, -d);
      osc('sawtooth', f, d);
      if (subOk) osc('sawtooth', f / 2, d * 0.5, 0.4);
      break;
    }
    case 'supersaw': {
      const n = p.unison;
      const left = ctx.createStereoPanner();
      const right = ctx.createStereoPanner();
      left.pan.value = -p.spread;
      right.pan.value = p.spread;
      left.connect(dest);
      right.connect(dest);
      for (let i = 0; i < n; i++) {
        const pos = n === 1 ? 0 : i / (n - 1) - 0.5;
        osc('sawtooth', f, pos * p.detune * 100, 1 / Math.sqrt(n), i % 2 ? right : left);
      }
      break;
    }
    case 'fm':
    case 'bell': {
      const car = osc('sine', f);
      const mod = ctx.createOscillator();
      mod.type = 'sine';
      mod.frequency.value = f * p.fmh;
      const mg = ctx.createGain();
      const depth = f * p.fm;
      if (p.fmattack !== null || p.fmdecay !== null) {
        // envolvente del índice de modulación (fmattack / fmdecay / fmsustain, lineal o exponencial)
        const a = p.fmattack ?? 0.001;
        const sus = Math.max(0.0001, depth * p.fmsustain);
        mg.gain.setValueAtTime(p.fmattack !== null ? 0.0001 : depth, start);
        if (p.fmattack !== null) {
          if (p.fmexp) mg.gain.exponentialRampToValueAtTime(Math.max(0.0001, depth), start + a);
          else mg.gain.linearRampToValueAtTime(depth, start + a);
        }
        if (p.fmdecay !== null) {
          if (p.fmexp) mg.gain.exponentialRampToValueAtTime(sus, start + a + p.fmdecay);
          else mg.gain.linearRampToValueAtTime(depth * p.fmsustain, start + a + p.fmdecay);
        }
      } else mg.gain.value = depth;
      mod.connect(mg).connect(car.frequency);
      mod.start(start);
      mod.stop(stopAt);
      nodes.push(mod);
      break;
    }
    case 'b808': {
      const o = osc('sine', f);
      o.frequency.setValueAtTime(f * 2.2, start);
      o.frequency.exponentialRampToValueAtTime(f, start + 0.045);
      break;
    }
    case 'white':
    case 'noise':
    case 'pink':
    case 'brown': {
      const color = p.s === 'pink' || p.s === 'brown' ? p.s : 'white';
      const src = ctx.createBufferSource();
      src.buffer = noise(ctx, color);
      src.loop = true;
      src.connect(dest);
      src.start(start, Math.random() * 1.5);
      src.stop(stopAt);
      nodes.push(src);
      break;
    }
    default:
      osc('triangle', f);
  }
  if (p.subosc > 0 && p.s !== 'sub' && subOk) osc('sine', f / 2, 0, p.subosc * 0.8);
  if (p.noise > 0 && !['white', 'noise', 'pink', 'brown'].includes(p.s)) {
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx, 'white');
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = p.noise * 0.25;
    src.connect(g).connect(dest);
    src.start(start, Math.random() * 1.5);
    src.stop(stopAt);
    nodes.push(src);
  }
  if (p.vib > 0) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = p.vib;
    const lg = ctx.createGain();
    lg.gain.value = p.vibmod * 100;
    lfo.connect(lg);
    for (const o of nodes) if (o.detune) lg.connect(o.detune);
    lfo.start(start);
    lfo.stop(stopAt);
  }
  return nodes;
}

/**
 * Reproduce una voz.
 * env = { ctx, mixer, kit, bank, track, cps, coarseReady }
 * Devuelve { end, start } o null si no hay sonido.
 */
export function playVoice(env, p, t) {
  const { ctx, mixer } = env;
  const bus = mixer.bus(env.track);
  const start = Math.max(t, ctx.currentTime);
  if (start - t > 0.25) return null; // demasiado tarde: mejor no sonar que sonar a destiempo
  if (p.orbit !== null) mixer.noteOrbit(p.orbit, env.track);

  // --- fuente + envolvente ---
  const amp = ctx.createGain();
  let end;
  let sources;
  let entry = null;
  if (p.synth) {
    const holdEnd = start + p.dur;
    end = scheduleADSR(amp.gain, start, holdEnd, p, p.peak);
    sources = oscillators(ctx, p, start, end + 0.05, amp);
  } else {
    const res = resolveBuffer(env, p);
    if (!res) return null;
    const buf = res.buffer;
    const src = ctx.createBufferSource();
    src.buffer = p.speed < 0 ? reversed(buf) : buf;
    const rate = sampleRate(p, buf.duration, res.baseNote);
    src.playbackRate.value = rate;
    if (p.accelerate) {
      // anclado al inicio de la nota (si no, la rampa empezaría al programar la voz)
      src.playbackRate.setValueAtTime(rate, start);
      src.playbackRate.linearRampToValueAtTime(Math.max(0.01, rate * (1 + p.accelerate)), start + Math.max(0.05, p.dur));
    }
    const b = p.speed < 0 ? 1 - p.end : p.begin;
    const e = p.speed < 0 ? 1 - p.begin : p.end;
    const offset = b * buf.duration;
    const natural = ((e - b) * buf.duration) / rate;
    let playDur = natural;
    if (p.hold !== null) playDur = Math.min(natural, p.hold);
    playDur = Math.max(0.003, playDur);
    const gainRec = recordParam(amp.gain);
    if (p.env) {
      // ADSR explícito (s("oh").decay(.1)): la envolvente manda y puede acortar el sample
      const holdEnd = start + (p.hold !== null ? Math.min(p.hold, natural) : natural);
      const envEnd = scheduleADSR(gainRec, start, holdEnd, p, p.peak);
      const silentAt = p.sustain === 0 && p.decay > 0 ? start + p.attack + p.decay + 0.01 : envEnd;
      end = Math.min(start + natural + p.release, Math.max(start + 0.003, Math.min(envEnd, silentAt)));
    } else {
      // micro-fundidos: todos los puntos quedan dentro de la duración (también en trozos de < 2 ms)
      const fade = Math.min(0.004, playDur / 4);
      const atkEnd = start + Math.min(0.001, playDur / 2);
      gainRec.setValueAtTime(0, start);
      gainRec.linearRampToValueAtTime(p.peak, atkEnd);
      end = start + playDur;
      const relStart = Math.min(end, Math.max(atkEnd, end - (p.hold !== null ? Math.min(p.release, playDur / 2) : fade)));
      gainRec.setValueAtTime(p.peak, relStart);
      gainRec.linearRampToValueAtTime(0, end);
    }
    src.connect(amp);
    src.start(start, offset, Math.max(0.001, (end - start) * rate));
    src.stop(end + 0.02);
    sources = [src];
    // grupos de corte: un sonido nuevo corta el anterior del mismo grupo
    if (p.cut !== null) {
      const prev = bus.cuts.get(p.cut);
      if (prev && prev.start > start) {
        // llegó fuera de orden (un golpe anterior programado después de uno posterior): este suena hasta que
        // empieza el posterior, y el posterior sigue siendo el último del grupo
        const at = prev.start;
        if (at < end) {
          const v = envelopeValueAt(gainRec.points, at);
          amp.gain.cancelScheduledValues(at);
          amp.gain.linearRampToValueAtTime(v, at);
          amp.gain.setTargetAtTime(0, at, 0.004);
          try {
            src.stop(at + 0.03);
          } catch {
            /* ya parado */
          }
          end = Math.min(end, at + 0.03);
        }
      } else {
        if (prev && prev.end > start) {
          const g = prev.amp.gain;
          if (prev.start >= start) {
            // empezaban a la vez: suena el último en llegar (como en el export, que va en orden estable)
            g.cancelScheduledValues(start);
            g.setValueAtTime(0, start);
          } else if (typeof g.cancelAndHoldAtTime === 'function') {
            g.cancelAndHoldAtTime(start);
            g.setTargetAtTime(0, start, 0.004);
          } else {
            // sin cancelAndHoldAtTime (p. ej. Firefox): se calcula el valor real de la envolvente en ese instante.
            // Se llega a él con una rampa (no con setValueAtTime): al cancelar se borra la rampa en curso y, como
            // esto se programa por adelantado, el tramo hasta el corte se quedaría en el pico. La envolvente es
            // lineal a trozos, así que la rampa hasta (start, v) sigue exactamente la misma línea.
            const v = envelopeValueAt(prev.points, start);
            g.cancelScheduledValues(start);
            g.linearRampToValueAtTime(v, start);
            g.setTargetAtTime(0, start, 0.004);
          }
          for (const s of prev.sources) {
            try {
              s.stop(start + 0.03);
            } catch {
              /* ya parado */
            }
          }
        }
        entry = { amp, sources, end, start, peak: p.peak, points: gainRec.points };
        bus.cuts.set(p.cut, entry);
      }
    }
  }

  // --- envolvente de tono (penv en semitonos, vuelve al tono base en ~pdecay) ---
  if (p.penv !== 0) {
    for (const s of sources) {
      if (!s.detune) continue;
      const base = s.detune.value;
      const peak = base + p.penv * 100;
      if (p.pattack > 0) {
        s.detune.setValueAtTime(base, start);
        s.detune.linearRampToValueAtTime(peak, start + p.pattack);
      } else s.detune.setValueAtTime(peak, start);
      s.detune.setTargetAtTime(base, start + p.pattack, p.pdecay / 3);
    }
  }

  // --- cadena de efectos ---
  let node = amp;
  const chain = (n) => {
    node.connect(n);
    node = n;
  };
  if (p.coarse > 1 && env.coarseReady) {
    try {
      const w = new AudioWorkletNode(ctx, 'pulso-coarse', { parameterData: { factor: p.coarse } });
      chain(w);
    } catch {
      /* sin AudioWorklet: se omite */
    }
  }
  if (p.shape > 0) {
    const ws = ctx.createWaveShaper();
    ws.curve = curve('shape', p.shape);
    ws.oversample = '2x';
    chain(ws);
    if (p.shapevol !== 1) {
      // shape("x:vol") / shapevol: volumen tras la saturación (como en Strudel)
      const sv = ctx.createGain();
      sv.gain.value = p.shapevol;
      chain(sv);
    }
  }
  if (p.distort > 0) {
    const ws = ctx.createWaveShaper();
    ws.curve = curve('distort', p.distort);
    ws.oversample = '2x';
    chain(ws);
    // compensación de volumen × distortvol (distort("8:.4"))
    const comp = ctx.createGain();
    comp.gain.value = p.distortvol / (1 + p.distort * 0.35);
    chain(comp);
  }
  if (p.crush !== null && p.crush < 16) {
    const ws = ctx.createWaveShaper();
    ws.curve = curve('crush', p.crush);
    chain(ws);
  }
  if (p.lpf !== null) {
    const stages = p.ftype === '24db' ? 2 : 1;
    let first = null;
    for (let i = 0; i < stages; i++) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = stages === 2 ? p.lpq / 2 : p.lpq;
      f.frequency.value = p.lpf;
      filterEnv(f.frequency, p.lpf, p.lpenv, p, start);
      if (p.wob > 0) {
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = p.wob * env.cps;
        const lg = ctx.createGain();
        lg.gain.value = p.wobdepth * 600;
        lfo.connect(lg).connect(f.detune);
        lfo.start(start);
        lfo.stop(end + 0.05);
      }
      chain(f);
      first = first || f;
    }
  }
  if (p.hpf !== null) {
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = p.hpf;
    f.Q.value = p.hpq;
    filterEnv(f.frequency, p.hpf, p.hpenv, p, start);
    chain(f);
  }
  if (p.bpf !== null) {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = p.bpf;
    f.Q.value = p.bpq;
    filterEnv(f.frequency, p.bpf, p.bpenv, p, start);
    chain(f);
  }
  if (p.vowel) {
    // filtro de formantes: tres pasabanda en paralelo
    const sum = ctx.createGain();
    for (const [freq, g] of VOWELS[p.vowel]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = 8;
      const gg = ctx.createGain();
      gg.gain.value = g * 3;
      node.connect(bp).connect(gg).connect(sum);
    }
    node = sum;
  }
  if (p.phaser > 0) {
    // phaser: 4 pasatodo modulados por un LFO, mezclados con la señal seca
    const sum = ctx.createGain();
    node.connect(sum);
    let ap = node;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = p.phaser;
    const lg = ctx.createGain();
    lg.gain.value = 900 * p.phaserdepth;
    lfo.connect(lg);
    for (let i = 0; i < 4; i++) {
      const f = ctx.createBiquadFilter();
      f.type = 'allpass';
      f.frequency.value = 1000 + i * 350;
      f.Q.value = 0.7;
      lg.connect(f.frequency);
      ap.connect(f);
      ap = f;
    }
    ap.connect(sum);
    lfo.start(start);
    lfo.stop(end + 0.05);
    const trim = ctx.createGain();
    trim.gain.value = 0.6;
    sum.connect(trim);
    node = trim;
  }
  const pan = ctx.createStereoPanner();
  pan.pan.value = p.pan * 2 - 1;
  chain(pan);
  node.connect(bus.input);
  if (p.room > 0) {
    const g = ctx.createGain();
    g.gain.value = p.room;
    node.connect(g).connect(bus.send(p.size));
  }
  if (p.delay > 0) {
    mixer.setDelay(bus, start, p.delaytime, p.delayfeedback);
    const g = ctx.createGain();
    g.gain.value = p.delay;
    node.connect(g).connect(bus.delayIn);
  }
  if (p.duck) mixer.duck(p.duck, start, p.duckdepth, p.duckonset, p.duckrecover, p.duckhold);

  // liberar nodos al terminar
  const last = sources[sources.length - 1];
  if (last) {
    last.onended = () => {
      try {
        node.disconnect();
        amp.disconnect();
      } catch {
        /* ya desconectado */
      }
      if (entry && bus.cuts.get(p.cut) === entry) bus.cuts.delete(p.cut);
    };
  }
  return { end, start };
}

// Nombre real del sample teniendo en cuenta .bank(): "RolandTR909_bd", "RolandTR909:bd" o "bd".
export function sampleKeys(bankName, s) {
  return bankName ? [`${bankName}_${s}`, `${bankName}:${s}`, s] : [s];
}

// Devuelve { buffer, baseNote } o null. Primero samples cargados, luego el kit interno.
export function resolveBuffer(env, p) {
  for (const name of sampleKeys(p.bank, p.s)) {
    const fromBank = env.bank && env.bank.resolve(name, p.n, p.note);
    if (fromBank) return fromBank;
    const list = env.kit && env.kit.get(name);
    if (list && list.length) return { buffer: list[p.n % list.length], baseNote: SAMPLE_BASE_NOTE };
  }
  if (env.bank) for (const name of sampleKeys(p.bank, p.s)) if (env.bank.has(name)) env.bank.request(name);
  return null;
}
