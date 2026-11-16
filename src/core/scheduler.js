// Scheduler con "lookahead": consulta los patrones en ventanas contiguas de ciclos
// y entrega cada evento con su hora exacta de audio. No depende de Web Audio:
// el reloj (getTime) y el temporizador se inyectan, así se puede testear en Node.
import { F, Fraction } from './fraction.js';
import { TimeSpan } from './timespan.js';

const GRID = 1000; // las ventanas se alinean a 1/1000 de ciclo (fracciones pequeñas y exactas)
const quantize = (cycle) => new Fraction(Math.floor(cycle * GRID), GRID);

export class Scheduler {
  constructor({
    getTime,
    onTrigger,
    onError = () => {},
    interval = 0.025,
    lookahead = 0.15,
    latency = 0.05,
    maxLate = 0.3,
    setTimer = (fn, ms) => setInterval(fn, ms),
    clearTimer = (id) => clearInterval(id),
  }) {
    Object.assign(this, { getTime, onTrigger, onError, interval, lookahead, latency, maxLate, setTimer, clearTimer });
    this.tracks = [];
    this.cps = 0.725;
    this.started = false;
    this.timer = null;
    this.lastCycle = F(0);
    this.originTime = 0;
    this.originCycle = 0;
    this.stats = { ticks: 0, events: 0, skips: 0, errors: 0 };
    this.reported = new Set();
  }

  // tracks: [{ name, pattern, muted, duckOnly }]
  //   muted: no se programa; duckOnly: sólo dispara el sidechain (pista oculta por un solo)
  setTracks(tracks) {
    this.tracks = tracks;
    this.reported.clear();
  }

  cycleAt(time) {
    return this.originCycle + (time - this.originTime) * this.cps;
  }
  timeAt(cycle) {
    return this.originTime + (cycle - this.originCycle) / this.cps;
  }

  // Cambia el tempo sin saltos: se re-ancla en el último ciclo ya programado.
  setCps(cps) {
    if (!Number.isFinite(cps) || cps <= 0) throw new Error(`cps inválido: ${cps}`);
    if (this.started) {
      const c = this.lastCycle.valueOf();
      this.originTime = this.timeAt(c);
      this.originCycle = c;
    }
    this.cps = cps;
  }

  start(fromCycle = 0) {
    if (this.started) return;
    this.started = true;
    this.originTime = this.getTime() + this.latency;
    this.originCycle = fromCycle;
    this.lastCycle = quantize(fromCycle);
    this.tick();
    this.timer = this.setTimer(() => this.tick(), this.interval * 1000);
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  currentCycle() {
    return this.started ? this.cycleAt(this.getTime()) : this.lastCycle.valueOf();
  }

  tick() {
    if (!this.started) return;
    this.stats.ticks++;
    const now = this.getTime();
    // Si el hilo estuvo bloqueado mucho tiempo, saltamos hacia adelante en vez de disparar ráfagas.
    const nowCycle = this.cycleAt(now);
    if (nowCycle - this.lastCycle.valueOf() > this.maxLate * this.cps) {
      this.lastCycle = quantize(nowCycle);
      this.stats.skips++;
    }
    const target = quantize(this.cycleAt(now + this.lookahead));
    if (target.lte(this.lastCycle)) return;
    const begin = this.lastCycle;
    // Se reúnen los golpes de todas las pistas y se disparan en orden temporal (orden estable: a igual tiempo,
    // el de las pistas y capas). Así los grupos de corte y el sidechain se programan igual que en el export.
    const due = [];
    for (const track of this.tracks) {
      if (track.muted) continue;
      let haps;
      try {
        haps = track.pattern.queryArc(begin, target);
      } catch (e) {
        // se reintenta compás a compás: sólo calla el compás que falla (el siguiente empieza a tiempo)
        this.stats.errors++;
        if (!this.reported.has(track.name)) {
          this.reported.add(track.name);
          this.onError(e, track);
        }
        haps = [];
        for (const span of new TimeSpan(begin, target).spanCycles()) {
          try {
            haps.push(...track.pattern.queryArc(span.begin, span.end));
          } catch {
            /* compás roto: silencio */
          }
        }
      }
      for (const hap of haps) if (hap.hasOnset()) due.push({ hap, track });
    }
    due.sort((x, y) => x.hap.whole.begin.compare(y.hap.whole.begin));
    for (const { hap, track } of due) {
      const b = hap.whole.begin.valueOf();
      const e = hap.whole.end.valueOf();
      this.stats.events++;
      try {
        this.onTrigger({
          hap,
          value: hap.value,
          track: track.name,
          time: this.timeAt(b),
          duration: (e - b) / this.cps,
          cycle: b,
          cps: this.cps,
          duckOnly: !!track.duckOnly,
        });
      } catch (err) {
        this.stats.errors++;
        if (!this.reported.has(`${track.name}:trigger`)) {
          this.reported.add(`${track.name}:trigger`);
          this.onError(err, track);
        }
      }
    }
    this.lastCycle = target;
  }
}
