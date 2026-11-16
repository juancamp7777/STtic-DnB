// Motor de audio: une evaluador + scheduler + voces + mezclador.
import { evaluate } from '../core/eval.js';
import { Scheduler } from '../core/scheduler.js';
import { buildKit } from './drums.js';
import { Mixer } from './mixer.js';
import { playVoice, sampleKeys, WORKLET_SOURCE } from './voice.js';
import { resolveVoice, SYNTHS } from './params.js';
import { SampleBank } from './samples.js';
import { encodeWav, analyzeChannels } from './wav.js';

// Temporizador en un Worker: sigue funcionando aunque la pestaña esté en segundo plano.
function workerTimer() {
  try {
    const src = 'let id=null;onmessage=(e)=>{if(e.data.start){clearInterval(id);id=setInterval(()=>postMessage(0),e.data.ms)}else{clearInterval(id);id=null}}';
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    let fn = null;
    w.onmessage = () => fn && fn();
    return {
      set: (f, ms) => {
        fn = f;
        w.postMessage({ start: true, ms });
        return 1;
      },
      clear: () => {
        fn = null;
        w.postMessage({ start: false });
      },
    };
  } catch {
    return { set: (f, ms) => setInterval(f, ms), clear: (id) => clearInterval(id) };
  }
}

let workletUrl = null;
async function addWorklet(ctx) {
  try {
    if (!ctx.audioWorklet) return false;
    workletUrl ??= URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(workletUrl);
    return true;
  } catch {
    return false;
  }
}

const NEAR_CYCLES = 8;
// una nota MIDI que llega más tarde que esto se descarta (sonaría a destiempo)
const MIDI_LATE_MS = 30;

// orbit -> pistas que suenan en él (para duckorbit / duck("2")), calculado del patrón entre from y to
export function orbitMap(tracks, from, to) {
  const m = new Map();
  for (const t of tracks) {
    let haps;
    try {
      haps = t.pattern.onsets(from, to);
    } catch {
      continue;
    }
    for (const h of haps) {
      const o = h.value && typeof h.value === 'object' ? h.value.orbit : null;
      if (o == null || o === '' || !Number.isFinite(Number(o))) continue;
      const k = Math.round(Number(o));
      if (!m.has(k)) m.set(k, new Set());
      m.get(k).add(t.name);
    }
  }
  return m;
}
const copyOrbits = (m) => new Map([...m].map(([k, v]) => [k, new Set(v)]));

export class Engine {
  constructor({ onTrigger = () => {}, onError = () => {}, onState = () => {}, onWarning = () => {} } = {}) {
    this.onTrigger = onTrigger;
    this.onError = onError;
    this.onState = onState;
    this.onWarning = onWarning;
    this.ctx = null;
    this.tracks = [];
    this.cps = 174 / 240;
    this.voices = 0;
    this.maxVoices = 160;
    this.dropped = 0;
    this.gen = 0;
    this.evalGen = 0;
    this.loop = null; // { start, length } en ciclos
    this.initP = null;
    this.midiAccessP = null;
    this.playToken = 0;
  }

  // Idempotente: todas las llamadas esperan a la misma inicialización.
  init() {
    this.initP ??= this.doInit().catch((e) => {
      this.initP = null;
      throw e;
    });
    return this.initP;
  }

  async doInit() {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const [kit, coarseReady] = await Promise.all([buildKit(ctx.sampleRate), addWorklet(ctx)]);
    this.kit = kit;
    this.coarseReady = coarseReady;
    this.mixer = new Mixer(ctx);
    this.bank = new SampleBank(ctx);
    this.bank.onError = (url, e) => this.onWarning(`No se pudo cargar el sample ${url}: ${e.message}`);
    const timer = workerTimer();
    this.scheduler = new Scheduler({
      getTime: () => this.ctx.currentTime,
      onTrigger: (ev) => this.trigger(ev),
      onError: (e, track) => this.onError(e, track),
      setTimer: timer.set,
      clearTimer: timer.clear,
    });
  }

  knownSound(name, bankName = null) {
    for (const k of sampleKeys(bankName, name)) {
      if (SYNTHS.has(k) || this.kit?.has(k) || this.bank?.has(k)) return true;
    }
    return false;
  }

  // Samples externos que usan las pistas entre los ciclos from y to: Map(nombre -> Set({n, note}))
  collectSamples(tracks, from, to) {
    const used = new Map();
    for (const t of tracks) {
      let haps;
      try {
        haps = t.pattern.onsets(from, to);
      } catch {
        continue;
      }
      for (const h of haps) {
        const v = h.value;
        if (!v || typeof v !== 'object' || v.s == null) continue;
        const name = sampleKeys(v.bank, String(v.s)).find((k) => this.bank.has(k));
        if (!name) continue;
        if (!used.has(name)) used.set(name, new Map());
        const n = Math.floor(Number(v.n) || 0);
        used.get(name).set(`${n}|${v.note ?? ''}`, { n, note: typeof v.note === 'number' ? v.note : null });
      }
    }
    return new Map([...used].map(([k, m]) => [k, new Set(m.values())]));
  }

  // Patrón tal como se programa: con bucle, en el ciclo c suena start + ((c - start) mod compases)
  scheduledPattern(pattern) {
    return this.loop ? pattern.ribbon(this.loop.start, this.loop.length)._late(this.loop.start) : pattern;
  }

  // Precarga los samples de lo que va a sonar en [desde, desde + NEAR_CYCLES) (con el bucle en cuenta).
  // Devuelve la lista de avisos de los que no se pudieron cargar.
  async preloadNear(tracks, from) {
    const looped = tracks.map((t) => ({ ...t, pattern: this.scheduledPattern(t.pattern) }));
    const failed = await this.bank.preload(this.collectSamples(looped, from, from + NEAR_CYCLES));
    return failed.map((x) => `No se pudo cargar el sample "${x.name}" (${x.url}): ${x.message}`);
  }

  // ¿La pista está muda (código _nombre o botón M)? Si la pista no existe en el motor, decide el código.
  isMuted(name, codeMuted = false) {
    const t = this.tracks.find((x) => x.name === name);
    const bus = this.mixer?.buses.get(name);
    if (!t) return codeMuted || !!bus?.muted;
    return !!t.muted || !!bus?.muted;
  }

  // from: ciclo desde el que va a empezar a sonar si ahora está parado (para precargar lo que toca)
  async evaluate(code, { from = 0 } = {}) {
    await this.init();
    const gen = ++this.evalGen;
    // MIDI: cada evaluación vuelve a intentar el acceso y a avisar una vez
    if (this.midiFailed) this.midiAccessP = null;
    this.midiFailed = false;
    this.midiWarned = false;
    // un mapa de samples que llega cuando ya hay una evaluación más nueva no pisa al de la que suena
    const res = await evaluate(code, { samples: (src, base) => this.bank.load(src, base, () => gen === this.evalGen) });
    if (gen !== this.evalGen) return { ...res, stale: true };
    const total = res.form ? Math.ceil(res.form.cycles) : 16;
    const now = this.playing ? Math.max(0, Math.floor(this.cycle())) : Math.max(0, Math.floor(Number(from) || 0));
    // sonidos desconocidos y sidechain a pistas/orbits inexistentes
    const unknown = new Set();
    const badDuck = new Set();
    const names = new Set(res.tracks.map((t) => t.name));
    const orbitTracks = orbitMap(res.tracks, 0, total);
    const orbits = new Set([...orbitTracks.keys()].map(String));
    for (const t of res.tracks) {
      let haps = [];
      try {
        haps = t.pattern.onsets(0, total);
      } catch {
        continue;
      }
      for (const h of haps) {
        const v = h.value;
        if (!v || typeof v !== 'object') continue;
        // lo que va por MIDI (.midi() o .midiport(), la misma regla que resolveVoice) no necesita sonido
        if (v.s != null && v.midi == null && v.midiport == null && !this.knownSound(String(v.s), v.bank)) unknown.add(String(v.s));
        if (v.duck != null) {
          for (const d of String(v.duck).split(/[:\s,]+/).filter(Boolean)) {
            if (/^\d+$/.test(d) ? !orbits.has(d) : !names.has(d)) badDuck.add(d);
          }
        }
      }
    }
    // precarga: espera lo que suena pronto y descarga el resto en segundo plano
    const failedSamples = await this.preloadNear(res.tracks, now);
    if (gen !== this.evalGen) return { ...res, stale: true };
    this.bank.preload(this.collectSamples(res.tracks, 0, total)).catch(() => {});
    res.warnings = [
      ...(res.warnings || []),
      ...failedSamples,
      ...[...unknown].map((s) => `Sonido desconocido: "${s}"`),
      ...[...badDuck].map((d) => `duck("${d}"): no hay ninguna pista ni orbit con ese nombre`),
      ...res.duplicates.map((d) => `La pista "${d}" está definida dos veces: suena sólo la última`),
    ];
    this.tracks = res.tracks;
    // los orbits se conocen desde el principio (antes, el primer golpe de duckorbit no encontraba su destino)
    this.orbitTracks = orbitTracks;
    this.mixer.orbits = copyOrbits(orbitTracks);
    for (const t of res.tracks) this.mixer.bus(t.name);
    if (this.mixer.pruneSolo(names)) res.warnings.push('Se quitó el solo de pistas que ya no existen');
    this.applyTracks();
    if (this.scheduler.started) this.scheduler.setCps(res.cps);
    else this.scheduler.cps = res.cps;
    this.cps = res.cps;
    this.form = res.form;
    return res;
  }

  applyTracks() {
    if (!this.scheduler) return;
    this.scheduler.setTracks(
      this.tracks.map((t) => {
        // mute explícito (botón M o _nombre): no se programa. Oculta por un solo: sólo dispara su sidechain.
        const muted = t.muted || (this.mixer.buses.get(t.name)?.muted ?? false);
        const duckOnly = !muted && !this.mixer.isAudible(t.name);
        return { ...t, pattern: this.scheduledPattern(t.pattern), muted, duckOnly };
      }),
    );
  }

  setMuted(name, muted) {
    const t = this.tracks.find((x) => x.name === name);
    if (t) t.muted = muted;
    this.mixer.setMuted(name, muted);
    this.applyTracks();
  }
  setSolo(name, on) {
    this.mixer.setSolo(name, on);
    this.applyTracks();
  }
  setVolume(name, v) {
    this.mixer.setVolume(name, v);
  }
  // Repetir una sección: setLoop(inicio, compases) o setLoop(null)
  // La duración es exacta (una sección fill:0.5 se repite cada medio compás; el tema de 40.5 vuelve a 0 en 40.5)
  setLoop(start, length) {
    if (start == null) this.loop = null;
    else {
      const len = Number(length);
      this.loop = { start: Math.max(0, Number(start) || 0), length: Number.isFinite(len) && len > 0 ? Math.max(1 / 64, len) : 1 };
    }
    this.applyTracks();
  }

  async midiOut(port) {
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) throw new Error('Este navegador no tiene Web MIDI');
    // una sola petición de acceso (si no, cada nota abriría otra mientras el permiso está pendiente)
    this.midiAccessP ??= navigator.requestMIDIAccess().catch((e) => {
      this.midiFailed = true;
      throw e;
    });
    const access = await this.midiAccessP;
    const outs = [...access.outputs.values()];
    if (!outs.length) throw new Error('No hay salidas MIDI conectadas');
    if (!port || port === 'default' || port === 'true') return outs[0];
    return outs.find((o) => o.name && o.name.toLowerCase().includes(String(port).toLowerCase())) || outs[0];
  }

  async sendMidi(p, ev) {
    const out = await this.midiOut(p.midi);
    const note = Math.max(0, Math.min(127, Math.round(p.note ?? (p.freq ? 69 + 12 * Math.log2(p.freq / 440) : 60))));
    const ch = p.midichan - 1;
    const at = performance.now() + (ev.time - this.ctx.currentTime) * 1000;
    if (at < performance.now() - MIDI_LATE_MS) return false; // llegó tarde (p. ej. esperando el permiso): no suena
    out.send([0x90 | ch, note, p.midivel], at);
    out.send([0x80 | ch, note, 0], at + Math.max(5, ev.duration * 1000));
    return true;
  }

  trigger(ev) {
    const p = resolveVoice(ev.value, { duration: ev.duration, cps: ev.cps });
    if (!p) return;
    if (ev.duckOnly) {
      if (p.duck) this.mixer.duck(p.duck, Math.max(ev.time, this.ctx.currentTime), p.duckdepth, p.duckonset, p.duckrecover, p.duckhold);
      return;
    }
    if (p.midi) {
      this.sendMidi(p, ev).catch((e) => {
        if (!this.midiWarned) {
          this.midiWarned = true;
          this.onWarning(`MIDI: ${e.message}`);
        }
      });
      this.onTrigger({ ...ev, params: p });
      return;
    }
    if (this.voices >= this.maxVoices) {
      this.dropped++;
      return;
    }
    const res = playVoice(
      { ctx: this.ctx, mixer: this.mixer, kit: this.kit, bank: this.bank, track: ev.track, cps: ev.cps, coarseReady: this.coarseReady },
      p,
      ev.time,
    );
    if (!res) return;
    this.voices++;
    const gen = this.gen;
    const ms = Math.max(0, (res.end - this.ctx.currentTime) * 1000 + 50);
    setTimeout(() => {
      if (gen === this.gen) this.voices--;
    }, ms);
    this.onTrigger({ ...ev, params: p });
  }

  // Empieza a sonar desde un ciclo (0 = principio; F.startOf("drop") = desde el drop)
  async play(fromCycle = 0) {
    await this.init();
    const token = ++this.playToken;
    if (this.ctx.state !== 'running') await this.ctx.resume();
    if (this.scheduler.started) return;
    const from = Math.max(0, fromCycle);
    // los samples de lo primero que va a sonar tienen que estar listos (si no, los primeros golpes no suenan)
    const failed = await this.preloadNear(this.tracks, Math.floor(from));
    for (const w of failed) this.onWarning(w);
    if (token !== this.playToken || this.scheduler.started) return; // se paró (o se volvió a tocar) mientras cargaba
    this.scheduler.start(from);
    this.onState('playing');
  }

  stop() {
    if (!this.scheduler) return;
    this.playToken++;
    this.scheduler.stop();
    // silencio rápido: el mezclador viejo se apaga (con todo lo ya programado) y se crea uno nuevo
    const old = this.mixer;
    const t = this.ctx.currentTime;
    old.master.gain.cancelScheduledValues(t);
    old.master.gain.setTargetAtTime(0, t, 0.015);
    setTimeout(() => old.out.disconnect(), 500);
    const fresh = new Mixer(this.ctx);
    for (const [name, b] of old.buses) {
      const nb = fresh.bus(name);
      nb.muted = b.muted;
      nb.volume = b.volume;
      nb.fader.gain.value = b.volume;
    }
    for (const s of old.solo) fresh.solo.add(s);
    fresh.orbits = copyOrbits(old.orbits);
    fresh.applyMutes();
    this.mixer = fresh;
    this.voices = 0;
    this.gen++;
    this.onState('stopped');
  }

  get playing() {
    return !!this.scheduler?.started;
  }

  cycle() {
    return this.scheduler ? this.scheduler.currentCycle() : 0;
  }

  // Render offline (más rápido que tiempo real) -> { buffer, wav, stats }
  //   cycles: número o 'song' (desde from hasta el final del tema)   from: ciclo inicial
  //   onlyTracks: lista de pistas que suenan (las demás sólo aportan su sidechain)
  //   muted(name, mutaEnCodigo): pistas que no existen en el export (ni suenan ni hacen sidechain), como el botón M
  //   audible(name) / volumes: { pista: volumen } -> exporta lo que se oye en el mezclador (solo = sólo sidechain)
  //   raw: master sin compresor/limitador/clipper (stems)
  async render(code, { cycles = 16, from = 0, sampleRate = 44100, tail = 2.5, onlyTracks = null, audible = null, volumes = null, muted = null, raw = false } = {}) {
    await this.init();
    const res = await evaluate(code, { samples: (src, base) => this.bank.load(src, base) });
    from = Math.max(0, Number(from) || 0);
    if (cycles === 'song') {
      const songLen = res.form ? res.form.cycles : 16;
      cycles = songLen - (from % songLen);
    }
    cycles = Number(cycles);
    if (!(cycles > 0)) throw new Error('render: el número de compases tiene que ser mayor que 0');
    const seconds = cycles / res.cps + tail;
    const octx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
    const coarseReady = await addWorklet(octx);
    const mixer = new Mixer(octx, octx.destination, { raw });
    const isMuted = (t) => (muted ? !!muted(t.name, !!t.muted) : !!t.muted);
    const live = res.tracks.filter((t) => !isMuted(t));
    mixer.orbits = orbitMap(live, from, from + cycles);
    // audible(nombre, nombresDelCódigo): el solo sólo cuenta para pistas que existen en el código que se exporta
    const codeNames = res.tracks.map((t) => t.name);
    const sounding = live.filter((t) => (!onlyTracks || onlyTracks.includes(t.name)) && (!audible || audible(t.name, codeNames)));
    const soundingNames = new Set(sounding.map((t) => t.name));
    for (const t of live) {
      const b = mixer.bus(t.name);
      const v = volumes && Number.isFinite(volumes[t.name]) ? volumes[t.name] : 1;
      b.volume = v;
      b.fader.gain.value = v;
    }
    const failedSamples = await this.bank.preload(this.collectSamples(sounding, from, from + cycles));
    // Todos los eventos con su hora, ordenados. Se programan por bloques de 1 s usando
    // suspend(): así sólo existen los nodos de las voces que suenan (render mucho más rápido).
    const lead = 0.05;
    const queue = [];
    for (const t of live) {
      const duckOnly = !soundingNames.has(t.name);
      for (const h of t.pattern.onsets(from, from + cycles)) {
        if (duckOnly && !(h.value && h.value.duck != null)) continue;
        const b = h.whole.begin.valueOf();
        queue.push({ time: lead + (b - from) / res.cps, dur: (h.whole.end.valueOf() - b) / res.cps, value: h.value, track: t.name, duckOnly });
      }
    }
    queue.sort((a, b) => a.time - b.time);
    let events = 0;
    let qi = 0;
    const scheduleUntil = (tEnd) => {
      while (qi < queue.length && queue[qi].time < tEnd) {
        const q = queue[qi++];
        const p = resolveVoice(q.value, { duration: q.dur, cps: res.cps });
        if (!p || p.midi) continue;
        if (q.duckOnly) {
          if (p.duck) mixer.duck(p.duck, q.time, p.duckdepth, p.duckonset, p.duckrecover, p.duckhold);
          continue;
        }
        const r = playVoice({ ctx: octx, mixer, kit: this.kit, bank: this.bank, track: q.track, cps: res.cps, coarseReady }, p, q.time);
        if (r) events++;
      }
    };
    const CHUNK = 1;
    if (typeof octx.suspend !== 'function') {
      // Firefox no tiene OfflineAudioContext.suspend(): se programan todas las voces antes de renderizar
      // (mismo resultado, sólo usa más memoria mientras dura el render)
      scheduleUntil(Infinity);
    } else {
      scheduleUntil(CHUNK);
      for (let k = 1; k * CHUNK < seconds && qi < queue.length; k++) {
        const at = k * CHUNK;
        octx.suspend(at).then(() => {
          scheduleUntil(at + CHUNK);
          octx.resume();
        });
      }
    }
    const buffer = await octx.startRendering();
    const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
    const stats = { ...analyzeChannels(channels, sampleRate), events, bpm: res.bpm, cycles, from, tracks: sounding.map((t) => t.name) };
    const warnings = failedSamples.map((x) => `No se pudo cargar el sample "${x.name}" (${x.url}): ${x.message}`);
    // sin la cadena del master (stems) el WAV va en coma flotante de 32 bits: lo que pase de 0 dBFS no se recorta
    return { buffer, stats, warnings, wav: () => encodeWav(channels, sampleRate, { float: raw }) };
  }

  // Stems: un WAV por pista (cada una con el sidechain de las demás), sin la cadena del master.
  async renderStems(code, opts = {}) {
    await this.init();
    const res = await evaluate(code, { samples: (src, base) => this.bank.load(src, base) });
    const { muted = null } = opts;
    const out = [];
    for (const t of res.tracks.filter((x) => (muted ? !muted(x.name, !!x.muted) : !x.muted))) {
      const r = await this.render(code, { ...opts, audible: null, onlyTracks: [t.name], raw: true });
      if (r.stats.peakDb > 0) {
        r.warnings.push(
          `El stem "${t.name}" pasa de 0 dBFS (pico +${r.stats.peakDb.toFixed(1)} dB): el WAV es de 32 bits en coma flotante y no se pierde nada, pero baja su volumen si lo vas a usar fuera de un DAW`,
        );
      }
      out.push({ name: t.name, ...r });
    }
    return out;
  }
}
