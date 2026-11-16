// Análisis estático de una canción (sin audio): valida y describe qué suena en cada sección.
// Lo usan los tests y la herramienta de línea de comandos (tools/pulso.js).
import { evaluate } from '../core/eval.js';
import { resolveVoice, SYNTHS, MIN_SUB_LAYER_HZ } from '../audio/params.js';
import { SOUND_NAMES } from '../audio/drums.js';
import { midiToName } from '../core/theory.js';
import { NUMERIC_CONTROLS } from '../core/controls.js';

export const KNOWN_SOUNDS = new Set([...SYNTHS, ...SOUND_NAMES]);
const LOWEST_BASS_MIDI = 26; // D1 (36,7 Hz): por debajo, la fundamental casi no se oye

export async function analyzeSong(code, { extraSounds = [], hooks = {} } = {}) {
  const known = new Set([...KNOWN_SOUNDS, ...extraSounds]);
  const report = { ok: false, errors: [], warnings: [], bpm: null, cycles: 0, form: null, tracks: [], sections: [] };
  let res;
  try {
    res = await evaluate(code, hooks);
  } catch (e) {
    report.errors.push(e.message);
    return report;
  }
  report.result = res;
  report.bpm = res.bpm;
  for (const e of res.errors) report.errors.push(`pista "${e.track}": ${e.message}`);
  for (const w of res.warnings || []) report.warnings.push(w);
  for (const d of res.duplicates || []) report.errors.push(`la pista "${d}" está definida dos veces (la segunda reemplaza a la primera)`);
  if (res.tracks.length === 0) report.errors.push('No hay pistas: usa "nombre: patrón" o deja un patrón como última expresión');
  if (res.bpm < 150 || res.bpm > 185) report.warnings.push(`${Math.round(res.bpm)} BPM está fuera del rango típico de DnB (160–180)`);
  const cycles = res.form ? res.form.cycles : 16;
  report.cycles = cycles;
  report.form = res.form ? res.form.sections.map((s) => ({ ...s })) : null;
  const names = res.tracks.map((t) => t.name);
  // con samples() externos no se puede saber qué sonidos existen: los desconocidos son sólo aviso
  const unknownIsError = !res.usesSamples;

  const sectionsRanges = [];
  if (res.form) {
    let start = 0;
    for (const s of res.form.sections) {
      sectionsRanges.push({ name: s.name, start, length: s.length, active: [], events: 0 });
      start += s.length;
    }
  } else sectionsRanges.push({ name: '(bucle)', start: 0, length: cycles, active: [], events: 0 });

  const orbits = new Set();
  for (const t of res.tracks) {
    try {
      for (const h of t.pattern.onsets(0, cycles)) if (h.value && h.value.orbit != null) orbits.add(String(Math.round(Number(h.value.orbit))));
    } catch {
      /* se reporta abajo */
    }
  }

  // las variantes A/B en reserva (bass: + _bass:) se validan como pistas mudas: sus errores salen antes del directo
  const toCheck = [
    ...res.tracks.map((t) => ({ t, label: `pista "${t.name}"`, alternate: false })),
    ...(res.alternates || []).map((t) => ({ t: { ...t, muted: true }, label: `pista "${t.name}" (variante en reserva)`, alternate: true })),
  ];
  for (const { t, label, alternate } of toCheck) {
    const info = { name: t.name, muted: t.muted, alternate, events: 0, sounds: new Map(), noteMin: null, noteMax: null, maxSimultaneous: 0, maxGain: 0, sections: {} };
    report.tracks.push(info);
    let haps;
    try {
      haps = t.pattern.onsets(0, cycles);
    } catch (e) {
      report.errors.push(`${label}: ${e.message}`);
      continue;
    }
    info.events = haps.length;
    const perTime = new Map();
    let lowLayerHz = null;
    for (const h of haps) {
      const b = h.whole.begin.valueOf();
      const k = h.whole.begin.toString();
      perTime.set(k, (perTime.get(k) || 0) + 1);
      for (const sec of sectionsRanges) {
        if (b >= sec.start && b < sec.start + sec.length) {
          info.sections[sec.name] = (info.sections[sec.name] || 0) + 1;
          if (!t.muted) sec.events++;
          break;
        }
      }
      const v = h.value;
      if (v && typeof v === 'object') {
        for (const [key, x] of Object.entries(v)) {
          if (NUMERIC_CONTROLS.has(key) && typeof x === 'string' && !Number.isFinite(Number(x))) {
            report.errors.push(`${label}: ${key} recibió "${x}", que no es un número`);
          }
        }
      }
      const p = resolveVoice(v, { duration: h.whole.duration().valueOf() / res.cps, cps: res.cps });
      if (!p) {
        report.errors.push(`${label}: evento sin sonido (${JSON.stringify(v)}) en el ciclo ${b}`);
        continue;
      }
      if (!p.midi && !known.has(p.s)) {
        const msg = `${label}: sonido desconocido "${p.s}"`;
        if (unknownIsError) report.errors.push(msg);
        else report.warnings.push(`${msg} (¿está en tus samples?)`);
      }
      info.sounds.set(p.s, (info.sounds.get(p.s) || 0) + 1);
      for (const [key, x] of Object.entries(p)) {
        if (typeof x === 'number' && !Number.isFinite(x)) report.errors.push(`${label}: ${key} no es finito`);
      }
      if (p.peak > info.maxGain) info.maxGain = p.peak;
      if (p.synth) {
        const m = 69 + 12 * Math.log2(p.freq / 440);
        info.noteMin = info.noteMin === null ? m : Math.min(info.noteMin, m);
        info.noteMax = info.noteMax === null ? m : Math.max(info.noteMax, m);
        if (p.freq < 25 || p.freq > 8000) report.errors.push(`${label}: frecuencia ${p.freq.toFixed(0)} Hz fuera de rango útil (25–8000)`);
        // subosc pedido a mano que el motor omitirá por quedar por debajo de 30 Hz
        if (p.subosc > 0 && p.freq / 2 < MIN_SUB_LAYER_HZ) lowLayerHz = Math.min(lowLayerHz ?? Infinity, p.freq / 2);
      }
      if (p.duck) {
        for (const d of p.duck) {
          if (/^\d+$/.test(d) ? !orbits.has(d) : !names.includes(d)) report.errors.push(`${label}: duck("${d}") apunta a una pista u orbit que no existe`);
        }
      }
    }
    info.maxSimultaneous = Math.max(0, ...perTime.values());
    if (info.events / cycles >= 160) report.errors.push(`${label}: densidad excesiva (${(info.events / cycles).toFixed(0)} eventos por compás)`);
    if (info.maxSimultaneous > 24) report.errors.push(`${label}: ${info.maxSimultaneous} voces a la vez (máximo 24)`);
    if (info.maxGain > 2.5) report.errors.push(`${label}: ganancia excesiva (${info.maxGain.toFixed(2)})`);
    else if (info.maxGain > 1.5) report.warnings.push(`${label}: ganancia alta (${info.maxGain.toFixed(2)}), el limitador trabajará mucho`);
    if (info.events === 0 && !t.muted) report.warnings.push(`${label} no suena nunca en ${cycles} compases`);
    if (/bass|sub|bajo/i.test(t.name) && info.noteMax !== null && info.noteMax > 55) {
      report.warnings.push(`${label}: llega a ${midiToName(info.noteMax)}, alto para un bajo`);
    }
    if (/bass|sub|bajo/i.test(t.name) && info.noteMin !== null && info.noteMin < LOWEST_BASS_MIDI - 0.01) {
      report.warnings.push(`${label}: baja hasta ${midiToName(info.noteMin)} (${(440 * 2 ** ((info.noteMin - 69) / 12)).toFixed(0)} Hz); por debajo de D1 casi no se oye. Prueba rootNotes("e1")`);
    }
    if (lowLayerHz !== null) {
      report.warnings.push(`${label}: su capa de sub-octava quedaría a ${lowLayerHz.toFixed(0)} Hz y se omite (sube una octava o quita subosc)`);
    }
    if (!t.muted) for (const sec of sectionsRanges) if (info.sections[sec.name]) sec.active.push(t.name);
  }
  for (const sec of sectionsRanges) if (sec.events === 0) report.warnings.push(`la sección "${sec.name}" está en silencio`);
  report.sections = sectionsRanges;
  report.errors = [...new Set(report.errors)];
  report.warnings = [...new Set(report.warnings)];
  report.ok = report.errors.length === 0;
  return report;
}

const pad = (s, n) => String(s).padEnd(n);
export function formatReport(rep, label = '') {
  const L = [];
  L.push(`${rep.ok ? '✔' : '✖'} ${label}  ${rep.bpm ? Math.round(rep.bpm) + ' BPM' : ''}  ${rep.cycles} compases`);
  if (rep.sections.length) {
    L.push('  Secciones:');
    for (const s of rep.sections) L.push(`    ${pad(s.name, 10)} ${pad(`c${s.start + 1}-${s.start + s.length}`, 9)} ${pad(s.events + ' ev', 8)} ${s.active.join(', ') || '(silencio)'}`);
  }
  if (rep.tracks.length) {
    L.push('  Pistas:');
    for (const t of rep.tracks) {
      const sounds = [...t.sounds.entries()].map(([k, v]) => `${k}×${v}`).join(' ');
      const range = t.noteMin !== null ? ` notas ${midiToName(t.noteMin)}–${midiToName(t.noteMax)}` : '';
      L.push(`    ${pad(t.name + (t.alternate ? ' (reserva)' : t.muted ? ' (muda)' : ''), 12)} ${pad(t.events + ' ev', 9)} máx ${t.maxSimultaneous} a la vez${range}  ${sounds}`);
    }
  }
  for (const e of rep.errors) L.push(`  ✖ ${e}`);
  for (const w of rep.warnings) L.push(`  ⚠ ${w}`);
  return L.join('\n');
}
