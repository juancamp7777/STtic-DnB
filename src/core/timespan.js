import { F, fmax, fmin } from './fraction.js';

export class TimeSpan {
  constructor(begin, end) {
    this.begin = F(begin);
    this.end = F(end);
  }

  // Divide el span en trozos que no cruzan límites de ciclo.
  spanCycles() {
    const out = [];
    let b = this.begin;
    const e = this.end;
    if (b.eq(e)) return [new TimeSpan(b, e)];
    while (b.lt(e)) {
      const next = b.sam().add(1);
      const end = next.lt(e) ? next : e;
      out.push(new TimeSpan(b, end));
      b = end;
    }
    return out;
  }

  withTime(f) { return new TimeSpan(f(this.begin), f(this.end)); }

  // Aplica f a la posición dentro del ciclo del inicio del span.
  withCycle(f) {
    const sam = this.begin.sam();
    return new TimeSpan(sam.add(f(this.begin.sub(sam))), sam.add(f(this.end.sub(sam))));
  }

  intersection(o) {
    const b = fmax(this.begin, o.begin);
    const e = fmin(this.end, o.end);
    if (b.gt(e)) return null;
    if (b.eq(e)) {
      // Intersección de ancho cero: sólo válida si alguno de los spans es un punto,
      // y no si cae justo en el borde final de un span con duración.
      const thisPoint = this.begin.eq(this.end);
      const otherPoint = o.begin.eq(o.end);
      if (!thisPoint && !otherPoint) return null;
      if (!thisPoint && b.eq(this.end)) return null;
      if (!otherPoint && b.eq(o.end)) return null;
    }
    return new TimeSpan(b, e);
  }

  duration() { return this.end.sub(this.begin); }
  midpoint() { return this.begin.add(this.duration().div(2)); }
  equals(o) { return this.begin.eq(o.begin) && this.end.eq(o.end); }
  toString() { return `${this.begin}→${this.end}`; }
}

export class Hap {
  constructor(whole, part, value, context = {}) {
    this.whole = whole;
    this.part = part;
    this.value = value;
    this.context = context;
  }
  wholeOrPart() { return this.whole || this.part; }
  hasOnset() { return !!this.whole && this.whole.begin.eq(this.part.begin); }
  withSpan(f) { return new Hap(this.whole ? f(this.whole) : null, f(this.part), this.value, this.context); }
  withValue(f) { return new Hap(this.whole, this.part, f(this.value), this.context); }
  duration() { return this.wholeOrPart().duration(); }
  setContext(ctx) { return new Hap(this.whole, this.part, this.value, ctx); }
  toString() { return `(${this.whole ? this.whole : '~'} | ${this.part}) ${JSON.stringify(this.value)}`; }
}

export class State {
  constructor(span, controls = {}) {
    this.span = span;
    this.controls = controls;
  }
  setSpan(span) { return new State(span, this.controls); }
  withSpan(f) { return new State(f(this.span), this.controls); }
}
