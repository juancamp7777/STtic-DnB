import assert from 'node:assert/strict';
import { F } from '../src/core/fraction.js';
import { analyzeSong, KNOWN_SOUNDS } from '../src/tools/analyze.js';

export { KNOWN_SOUNDS };

// Serializa eventos con onset para comparar patrones.
export function ev(pat, b = 0, e = 1) {
  return pat.onsets(b, e).map((h) => [h.whole.begin.toString(), h.whole.end.toString(), show(h.value)]);
}
export function vals(pat, b = 0, e = 1) {
  return pat.onsets(b, e).map((h) => h.value);
}
export function show(v) {
  if (v && typeof v === 'object') {
    return Object.keys(v)
      .sort()
      .map((k) => `${k}=${typeof v[k] === 'number' ? +v[k].toFixed(6) : v[k]}`)
      .join(',');
  }
  return typeof v === 'number' ? String(+v.toFixed(6)) : String(v);
}
const key = (h) => `${h.whole.begin}|${h.whole.end}|${show(h.value)}`;

// Consultar [0,c) de una vez o en trozos contiguos aleatorios debe dar los mismos onsets.
export function assertSplitInvariant(pat, cycles, r = Math.random, label = '') {
  const whole = pat.onsets(0, cycles).map(key).sort();
  const parts = [];
  let t = F(0);
  const end = F(cycles);
  while (t.lt(end)) {
    const den = [3, 7, 16, 1000, 24, 5][Math.floor(r() * 6)];
    const step = F(Math.max(1, Math.floor(r() * den))).div(den);
    let next = t.add(step);
    if (next.gt(end)) next = end;
    for (const h of pat.queryArc(t, next)) {
      if (h.hasOnset()) {
        assert.ok(h.whole.begin.gte(t) && h.whole.begin.lt(next), `${label}: onset fuera de la ventana`);
        parts.push(key(h));
      }
    }
    t = next;
  }
  parts.sort();
  assert.deepEqual(parts, whole, `${label}: consultas partidas ≠ consulta entera`);
}

// Invariantes estructurales de todos los haps de una consulta.
export function assertWellFormed(pat, b, e, label = '') {
  for (const h of pat.queryArc(b, e)) {
    assert.ok(h.part.begin.lte(h.part.end), `${label}: part invertido`);
    if (h.whole) {
      assert.ok(h.whole.begin.lt(h.whole.end), `${label}: whole vacío o invertido ${h.whole}`);
      assert.ok(h.part.begin.gte(h.whole.begin) && h.part.end.lte(h.whole.end), `${label}: part fuera de whole ${h}`);
    }
    assert.ok(h.part.end.gte(F(b)) && h.part.begin.lte(F(e)), `${label}: hap fuera de la consulta`);
  }
}

// Validación completa de una canción (temas incluidos y generados): sin errores ni avisos.
export async function validateSong(code, label = '', { allowWarnings = false } = {}) {
  const rep = await analyzeSong(code);
  assert.deepEqual(rep.errors, [], `${label}: errores`);
  if (!allowWarnings) assert.deepEqual(rep.warnings, [], `${label}: avisos`);
  const total = rep.tracks.reduce((a, t) => a + t.events, 0);
  assert.ok(total > 50, `${label}: muy pocos eventos (${total})`);
  return { res: rep.result, cycles: rep.cycles, total, rep };
}
