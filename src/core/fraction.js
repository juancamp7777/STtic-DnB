// Fracciones racionales exactas para el tiempo musical (evita errores de float
// en los límites de ciclo, que harían que el scheduler pierda o duplique notas).

const MAX_SAFE = 2 ** 48;

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

// Aproximación racional por fracciones continuas.
function approximate(x, maxDen = 1e9) {
  if (!Number.isFinite(x)) throw new Error(`Valor de tiempo no finito: ${x}`);
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  let h1 = 1, h0 = 0, k1 = 0, k0 = 1, b = x;
  for (let i = 0; i < 64; i++) {
    const a = Math.floor(b);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > maxDen) break;
    h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    if (Math.abs(x - h1 / k1) < 1e-12) break;
    const rest = b - a;
    if (rest < 1e-15) break;
    b = 1 / rest;
  }
  return [sign * h1, k1];
}

export class Fraction {
  constructor(n, d = 1) {
    if (d === 0) throw new Error('Fracción con denominador 0');
    if (!Number.isInteger(n) || !Number.isInteger(d)) {
      [n, d] = approximate(n / d);
    }
    if (d < 0) { n = -n; d = -d; }
    if (Math.abs(n) > MAX_SAFE || d > MAX_SAFE) {
      [n, d] = approximate(n / d, 1e7);
    }
    const g = gcd(n, d);
    this.n = n / g;
    this.d = d / g;
  }

  static from(x) {
    if (x instanceof Fraction) return x;
    if (typeof x === 'number') {
      if (Number.isInteger(x)) return new Fraction(x, 1);
      const [n, d] = approximate(x);
      return new Fraction(n, d);
    }
    if (typeof x === 'string') {
      const s = x.trim();
      if (/^-?\d+\/\d+$/.test(s)) {
        const [a, b] = s.split('/').map(Number);
        return new Fraction(a, b);
      }
      const v = Number(s);
      if (Number.isNaN(v)) throw new Error(`No es un número: "${x}"`);
      return Fraction.from(v);
    }
    if (typeof x === 'bigint') return new Fraction(Number(x), 1);
    throw new Error(`No se puede convertir a fracción: ${x}`);
  }

  add(o) { o = F(o); return new Fraction(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { o = F(o); return new Fraction(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { o = F(o); return new Fraction(this.n * o.n, this.d * o.d); }
  div(o) {
    o = F(o);
    if (o.n === 0) throw new Error('División por cero');
    return new Fraction(this.n * o.d, this.d * o.n);
  }
  neg() { return new Fraction(-this.n, this.d); }
  compare(o) { o = F(o); return this.n * o.d - o.n * this.d; }
  eq(o) { o = F(o); return this.n === o.n && this.d === o.d; }
  ne(o) { return !this.eq(o); }
  lt(o) { return this.compare(o) < 0; }
  lte(o) { return this.compare(o) <= 0; }
  gt(o) { return this.compare(o) > 0; }
  gte(o) { return this.compare(o) >= 0; }
  min(o) { o = F(o); return this.lte(o) ? this : o; }
  max(o) { o = F(o); return this.gte(o) ? this : o; }
  floor() { return new Fraction(Math.floor(this.n / this.d), 1); }
  ceil() { return new Fraction(Math.ceil(this.n / this.d), 1); }
  sam() { return this.floor(); }
  nextSam() { return this.sam().add(1); }
  cyclePos() { return this.sub(this.sam()); }
  mod(m) { m = F(m); return this.sub(m.mul(this.div(m).floor())); }
  valueOf() { return this.n / this.d; }
  toNumber() { return this.n / this.d; }
  toString() { return this.d === 1 ? `${this.n}` : `${this.n}/${this.d}`; }
  toJSON() { return this.toString(); }
}

export const F = (x) => Fraction.from(x);
export const fmin = (a, b) => (F(a).lte(b) ? F(a) : F(b));
export const fmax = (a, b) => (F(a).gte(b) ? F(a) : F(b));
