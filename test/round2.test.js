// Regresiones de la segunda revisión (verificación adversarial): cada test fija un fallo confirmado y corregido.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as P from '../src/core/index.js';
import { evaluate, transpile, QUEUE_WAIT_MS } from '../src/core/eval.js';
import { resolveVoice, envelopeValueAt, sizeForSeconds, REVERB_SIZES } from '../src/audio/params.js';
import { SampleBank, fetchWithTimeout } from '../src/audio/samples.js';
import { Engine, orbitMap } from '../src/audio/engine.js';
import { saveTrack, writeIndex, trackModuleSource, analyzeIsolated, normalizeCode } from '../src/tools/indexer.js';
import { analyzeSong } from '../src/tools/analyze.js';
import { parseChord } from '../src/core/theory.js';

// carpetas temporales de este archivo: se borran al terminar (en Windows, si algo aún las usa, se dejan)
const TEMP_DIRS = [];
const tmpDir = (prefix) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEMP_DIRS.push(d);
  return d;
};
after(() => {
  for (const d of TEMP_DIRS) {
    try {
      fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* en uso */
    }
  }
});

const { mini, pure, s, n, note } = P;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const up = (x) => x.fmap((v) => String(v).toUpperCase());
const val = (v) => (v && typeof v === 'object' ? JSON.stringify(v) : String(v));
// valores con onset de cada ciclo: "a b | c d"
const cycles = (pat, k) =>
  Array.from({ length: k }, (_, c) =>
    pat
      .onsets(c, c + 1)
      .map((h) => val(h.value))
      .join(' '),
  ).join(' | ');
const at = (pat, b = 0, e = 1) => pat.onsets(b, e).map((h) => `${val(h.value)}@${h.whole.begin}`);

// ---------------- patrones ----------------
test('chunk / chunkBack / fastChunk / repeatCycles como Strudel', () => {
  assert.equal(cycles(mini('a b c d').chunk(4, up), 5), 'A b c d | a B c d | a b C d | a b c D | A b c d');
  // chunk repite cada ciclo n veces (repeatCycles), como en Strudel 1.x
  assert.equal(cycles(mini('<a b>').chunk(2, up), 4), 'A | a | B | b');
  // chunkBack recorre los trozos hacia atrás: Q0, Q3, Q2, Q1
  assert.equal(cycles(mini('a b c d').chunkBack(4, up), 4), 'A b c d | a b c D | a b C d | a B c d');
  // fastChunk no repite ciclos
  assert.equal(cycles(mini('<a b>').fastChunk(2, up), 4), 'A | b | A | b');
  assert.equal(cycles(mini('<a b c>').repeatCycles(2), 6), 'a | a | b | b | c | c');
});

test('shuffle no vuelve a disparar notas largas; scramble elige trozos', () => {
  // una nota de un compás partida en 4: sólo el trozo que contiene su inicio suena como nota nueva
  for (let c = 0; c < 8; c++) assert.equal(pure('x').shuffle(4).onsets(c, c + 1).length, 1, `ciclo ${c}`);
  // shuffle es una permutación: cada paso aparece una vez por ciclo
  for (let c = 0; c < 8; c++) {
    assert.deepEqual(
      mini('a b c d').shuffle(4).onsets(c, c + 1).map((h) => h.value).sort(),
      ['a', 'b', 'c', 'd'],
    );
  }
  const sc = mini('a b c d').scramble(4);
  for (let c = 0; c < 8; c++) assert.equal(sc.onsets(c, c + 1).length, 4);
});

test('echoWith: la primera copia es el original sin desplazar', () => {
  assert.deepEqual(at(pure(0).echoWith(3, 1 / 8, (x, i) => x.add(i * 10)), 0, 1), ['0@0', '10@1/8', '20@1/4']);
});

test('pick / pickmod / inhabit / squeeze (orden de argumentos y lookups)', () => {
  assert.equal(cycles(mini('<0 1 2>').pick(['a', 'b']), 3), 'a | b | b', 'pick limita el índice');
  assert.equal(cycles(mini('<0 1 2>').pickmod(['a', 'b']), 3), 'a | b | a', 'pickmod da la vuelta');
  assert.equal(cycles(mini('<x y>').pick({ x: mini('a b'), y: 'c' }), 2), 'a b | c');
  assert.throws(() => mini('z').pick({ x: 'a' }).onsets(0, 1), /no existe la clave "z"/);
  // inhabit / squeeze meten el ciclo entero en el paso
  assert.deepEqual(at(mini('x y').inhabit({ x: mini('a b c d'), y: 'z' })), ['a@0', 'b@1/8', 'c@1/4', 'd@3/8', 'z@1/2']);
  assert.deepEqual(at(mini('x y').pick({ x: mini('a b c d'), y: 'z' })), ['a@0', 'b@1/4'], 'pick no comprime');
  const sq = ['a@0', 'b@1/4', 'z@1/2'];
  assert.deepEqual(at(P.squeeze(mini('x y'), { x: mini('a b'), y: 'z' })), sq);
  assert.deepEqual(at(P.squeeze({ x: mini('a b'), y: 'z' }, mini('x y'))), sq, 'squeeze admite los dos órdenes');
  assert.equal(cycles(P.pick(mini('<0 1>'), ['a', 'b']), 2), 'a | b');
  assert.equal(cycles(P.pick(['a', 'b'], mini('<0 1>')), 2), 'a | b');
  assert.equal(cycles(mini('<0 3>').inhabitmod(['a', 'b']), 2), 'a | b');
  // n("<0 1>").pick(...) también vale (Pulso acepta { n: 0 } como índice)
  assert.equal(cycles(n('<0 1>').pick(['a', 'b']), 2), 'a | b');
});

test('beat con patrones, undegrade, inv, slider y wchooseCycles', () => {
  assert.deepEqual(at(s('bd').beat('0,7,10', 16)).map((x) => x.split('@')[1]), ['0', '7/16', '5/8']);
  assert.deepEqual(at(s('bd').beat('<0 4>', 8), 0, 2).map((x) => x.split('@')[1]), ['0', '3/2']);
  const all = s('bd*8');
  const kept = all.degradeBy(0.5).onsets(0, 50).length;
  const other = all.undegrade().onsets(0, 50).length;
  assert.equal(kept + other, 400, 'degradeBy(.5) y undegrade() se reparten los golpes');
  assert.ok(kept > 150 && kept < 250, `reparto razonable (${kept}/400)`);
  assert.equal(all.degradeBy(0.5).undegrade().onsets(0, 10).length, 0);
  assert.equal(cycles(mini('1 0 true false').inv(), 1), 'false true false true');
  assert.equal(cycles(s('hh').gain(P.slider(0.5)), 1), '{"s":"hh","gain":0.5}');
  assert.equal(cycles(P.wchooseCycles([pure('a'), 1], [pure('b'), 0]), 6), 'a | a | a | a | a | a', 'peso 0 nunca sale');
  let a = 0;
  const w = P.wchooseCycles([pure('a'), 3], [pure('b'), 1]);
  for (let c = 0; c < 400; c++) if (w.onsets(c, c + 1)[0].value === 'a') a++;
  assert.ok(a > 250 && a < 350, `pesos 3:1 → ${a}/400`);
  assert.equal(P.wrandcat, P.wchooseCycles);
});

test('euclidLegatoRot rota como euclidRot y alarga hasta el siguiente golpe', () => {
  const h = pure('x').euclidLegatoRot(3, 8, 1).onsets(0, 1);
  assert.deepEqual(h.map((x) => `${x.whole.begin}-${x.whole.end}`), ['1/8-1/2', '1/2-7/8', '7/8-9/8']);
  assert.deepEqual(at(pure('x').euclidRot(3, 8, 1)).map((x) => x.split('@')[1]), ['1/8', '1/2', '7/8']);
});

test('arp: índices en orden del acorde apilado, modos por altura', () => {
  assert.equal(cycles(note('[g3,c3,e3]').arp('0 1 2'), 1), '{"note":55} {"note":48} {"note":52}');
  assert.equal(cycles(note('[g3,c3,e3]').arp('up'), 1), '{"note":48} {"note":52} {"note":55}');
  // n(...).chord().voicing(): el índice 4 de un acorde de 4 notas sube una octava
  const v = n('0 4').chord('Dm7').voicing().onsets(0, 1).map((x) => x.value.note);
  assert.equal(v[1] - v[0], 12);
});

// ---------------- mini-notación ----------------
test('mini: el operador ":" une valores (también con patrones)', () => {
  assert.equal(cycles(mini('bd:<0 3>'), 2), 'bd:0 | bd:3');
  assert.equal(cycles(mini('c:e:g'), 1), 'c:e:g');
  assert.equal(cycles(mini('a: b'), 1), 'a: b');
  assert.equal(cycles(s('bd:3 sn'), 1), '{"s":"bd","n":3} {"s":"sn"}');
  assert.equal(cycles(s('bd:<0 2>'), 2), '{"s":"bd","n":0} | {"s":"bd","n":2}');
});

// ---------------- teoría ----------------
test('acordes de iReal añadidos: 7#9#5 7#9b5 7b9b5 7b9#5 7susadd3', () => {
  for (const q of ['7#9#5', '7#9b5', '7b9b5', '7b9#5', '7susadd3']) assert.ok(parseChord(`C${q}`), q);
});

// ---------------- controles ----------------
test('controles compuestos y alias de Strudel', () => {
  const v1 = (pat) => pat.onsets(0, 1)[0].value;
  assert.deepEqual(v1(s('x').distort('8:.4')), { s: 'x', distort: 8, distortvol: 0.4 });
  assert.deepEqual(v1(s('x').shape('.6:.8')), { s: 'x', shape: 0.6, shapevol: 0.8 });
  assert.deepEqual(v1(s('x').vibmod('.3:5')), { s: 'x', vibmod: 0.3, vib: 5 });
  assert.deepEqual(v1(s('x').v('4:.2')), { s: 'x', vib: 4, vibmod: 0.2 });
  assert.deepEqual(v1(s('x').vmod(0.3)), { s: 'x', vibmod: 0.3 });
  assert.deepEqual(v1(s('x').distvol(0.5)), { s: 'x', distortvol: 0.5 });
  assert.deepEqual(v1(P.chord('C').mode('below:c4')), { chord: 'C', mode: 'below', anchor: 'c4' });
  assert.deepEqual(v1(s('x').distort(3)), { s: 'x', distort: 3 });
});

// ---------------- parámetros de voz ----------------
test('params: ftype numérico, size en segundos, distortvol/shapevol, MIDI sólo con .midi()', () => {
  const ft = (x) => resolveVoice({ s: 'saw', ftype: x }).ftype;
  assert.equal(ft('0'), '12db');
  assert.equal(ft(0), '12db');
  assert.equal(ft('1'), '24db', 'ladder = dos etapas');
  assert.equal(ft('2'), '24db');
  assert.equal(ft('24'), '24db');
  assert.equal(ft('12'), '12db');
  assert.equal(ft('ladder'), '24db');
  assert.equal(ft(undefined), '12db');
  // size 0–1: escala de Pulso; > 1: segundos (la reverb más parecida)
  assert.equal(resolveVoice({ s: 'bd', size: 0.3 }).size, 0.3);
  assert.equal(resolveVoice({ s: 'bd', size: 1 }).size, 1);
  const bucket = (sec) => Math.min(REVERB_SIZES.length - 1, Math.floor(resolveVoice({ s: 'bd', size: sec }).size * REVERB_SIZES.length));
  assert.equal(REVERB_SIZES[bucket(1.4)], 1.4);
  assert.equal(REVERB_SIZES[bucket(3)], 2.8);
  assert.equal(REVERB_SIZES[bucket(6)], 5.5);
  assert.equal(REVERB_SIZES[bucket(50)], 5.5);
  assert.ok(sizeForSeconds(2) > 0 && sizeForSeconds(2) < 1);
  const d = resolveVoice({ s: 'saw', distort: 8, distortvol: 0.4, shape: 0.5, shapevol: 0.7 });
  assert.equal(d.distortvol, 0.4);
  assert.equal(d.shapevol, 0.7);
  assert.equal(resolveVoice({ s: 'saw' }).distortvol, 1);
  assert.equal(resolveVoice({ s: 'saw' }).shapevol, 1);
  // midichan sin .midi() no desvía el sonido a MIDI
  assert.equal(resolveVoice({ s: 'saw', note: 48, midichan: 2 }).midi, null);
  assert.equal(resolveVoice({ s: 'saw', note: 48, midiport: 'IAC' }).midi, 'IAC');
  assert.equal(resolveVoice({ note: 48, midi: 'default' }).midi, 'default');
  // velocidad MIDI = 127 × gain × velocity (0.9) × postgain, sin la tabla de niveles de los synths
  assert.equal(resolveVoice({ s: 'sine', note: 60, midi: 'default' }).midivel, Math.round(127 * 0.9));
  assert.equal(resolveVoice({ s: 'saw', note: 60, midi: 'default', gain: 0.5, velocity: 1 }).midivel, 64);
  assert.equal(resolveVoice({ s: 'saw', note: 60, midi: 'default', gain: 4 }).midivel, 127);
  assert.equal(resolveVoice({ s: 'saw', note: 60, midi: 'default', gain: 0 }).midivel, 1);
});

test('envelopeValueAt sigue la semántica de AudioParam (grupos de corte sin cancelAndHoldAtTime)', () => {
  const pts = [
    [0, 0, 'set'],
    [0.001, 1, 'lin'],
    [0.5, 1, 'set'],
    [0.504, 0, 'lin'],
  ];
  assert.equal(envelopeValueAt(pts, -1), 0);
  assert.equal(envelopeValueAt(pts, 0.0005), 0.5);
  assert.equal(envelopeValueAt(pts, 0.3), 1);
  assert.ok(Math.abs(envelopeValueAt(pts, 0.502) - 0.5) < 1e-9);
  assert.equal(envelopeValueAt(pts, 1), 0);
  // ADSR que decae: a mitad del decay vale la mitad (antes saltaba al pico → clic)
  const adsr = [
    [0, 0, 'set'],
    [0.001, 1, 'lin'],
    [1.001, 0, 'lin'],
    [2, 0, 'set'],
    [2.01, 0, 'lin'],
  ];
  assert.ok(Math.abs(envelopeValueAt(adsr, 0.501) - 0.5) < 1e-9);
});

// ---------------- motor (partes sin audio) ----------------
test('motor: el bucle empieza en el inicio de la sección', () => {
  const e = new Engine();
  const pat = mini('<a b c d e f g h i j k l m n o p>');
  e.loop = { start: 8, length: 4 };
  const lp = e.scheduledPattern(pat);
  // en el ciclo 8 suena el 8 (i), y se repite i j k l
  assert.equal(cycles(lp.late(0), 16).split(' | ').slice(8, 16).join(' '), 'i j k l i j k l');
  assert.equal(lp.onsets(8, 9)[0].value, 'i');
  assert.equal(lp.onsets(12, 13)[0].value, 'i');
  assert.equal(lp.onsets(13, 14)[0].value, 'j');
  e.loop = null;
  assert.equal(e.scheduledPattern(pat), pat);
});

test('motor: mapa de orbits desde el patrón (duckorbit funciona desde el primer golpe)', () => {
  const tracks = [
    { name: 'bass', pattern: note('c2*4').s('sub').orbit(2) },
    { name: 'pads', pattern: P.chord('C').voicing().orbit('<2 3>') },
    { name: 'kick', pattern: s('bd*4').duckorbit(2) },
  ];
  const m = orbitMap(tracks, 0, 2);
  assert.deepEqual([...m.get(2)].sort(), ['bass', 'pads']);
  assert.deepEqual([...m.get(3)], ['pads']);
  assert.equal(m.has(1), false);
});

test('motor: isMuted (botón M y código) para exportar igual que en directo', () => {
  const e = new Engine();
  e.tracks = [
    { name: 'a', muted: false },
    { name: 'b', muted: true },
  ];
  e.mixer = { buses: new Map([['a', { muted: true }], ['b', { muted: false }]]) };
  assert.equal(e.isMuted('a'), true, 'M en el mezclador');
  assert.equal(e.isMuted('b'), true, '_b en el código');
  assert.equal(e.isMuted('c', true), true, 'pista que el motor no conoce: decide el código');
  assert.equal(e.isMuted('c', false), false);
});

test('motor: MIDI con velocidad de Strudel, una sola petición de acceso y notas tarde descartadas', async () => {
  const e = new Engine();
  e.ctx = { currentTime: 10 };
  const sent = [];
  let requests = 0;
  const access = { outputs: new Map([['x', { name: 'Sinte', send: (m, t) => sent.push([m, t]) }]]) };
  const hadNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { requestMIDIAccess: () => (requests++, new Promise((r) => setTimeout(() => r(access), 20))) },
  });
  try {
    const p = resolveVoice({ note: 60, midi: 'default', gain: 0.5, velocity: 1 }, { duration: 0.2 });
    // varias notas a la vez mientras el permiso está pendiente: una sola petición
    const r = await Promise.all([1, 2, 3].map(() => e.sendMidi(p, { time: 10.5, duration: 0.2 })));
    assert.equal(requests, 1);
    assert.deepEqual(r, [true, true, true]);
    assert.equal(sent[0][0][2], 64, 'velocidad = 127 × gain × velocity');
    // una nota que llega 100 ms tarde no se envía
    const late = await e.sendMidi(p, { time: 9.9, duration: 0.2 });
    assert.equal(late, false);
    assert.equal(sent.length, 6, '3 notas = 3 note-on + 3 note-off');
  } finally {
    if (hadNav) Object.defineProperty(globalThis, 'navigator', hadNav);
    else delete globalThis.navigator;
  }
});

// ---------------- evaluador ----------------
test('variantes A/B: la pista que suena gana y no es un duplicado', async () => {
  const v = (r) => r.tracks.map((t) => `${t.name}:${t.muted}:${t.pattern.onsets(0, 1)[0].value.s}`).join(' ');
  let r = await evaluate('bass: s("bd")\n_bass: s("sn")');
  assert.equal(v(r), 'bass:false:bd');
  assert.deepEqual(r.duplicates, []);
  r = await evaluate('_bass: s("bd")\nbass: s("sn")');
  assert.equal(v(r), 'bass:false:sn');
  assert.deepEqual(r.duplicates, []);
  r = await evaluate('_bass: s("bd")\nbass_: s("sn")');
  assert.equal(v(r), 'bass:true:sn', 'dos mudas: la última, sin aviso');
  assert.deepEqual(r.duplicates, []);
  r = await evaluate('bass: s("bd")\nbass: s("sn")');
  assert.equal(v(r), 'bass:false:sn');
  assert.deepEqual(r.duplicates, ['bass'], 'dos que suenan: aviso de duplicado');
  // el analizador tampoco lo trata como error
  const rep = await analyzeSong('bpm(174)\nbass: note("e1*4").s("sub")\n_bass: note("g1*4").s("sub")');
  assert.ok(rep.ok, rep.errors.join());
});

test('transpile: comentarios entre la cadena y el método, y métodos propios con register/define', async () => {
  assert.match(transpile('d: "bd sn" // golpe\n  .fast(2)'), /mini\("bd sn"\) \/\/ golpe/);
  assert.match(transpile('d: "bd sn" /* x */ .fast(2)'), /mini\("bd sn"\)/);
  let r = await evaluate('d: "bd sn" // comentario\n  .s()');
  assert.equal(cycles(r.tracks[0].pattern, 1), '{"s":"bd"} {"s":"sn"}');
  r = await evaluate('register("dobleR2", (pat) => pat.fast(2))\nd: "bd sn".s().dobleR2()');
  assert.equal(r.tracks[0].pattern.onsets(0, 1).length, 4);
  r = await evaluate("define('tripleR2', (p) => p.fast(3))\nd: \"bd\".s().tripleR2()");
  assert.equal(r.tracks[0].pattern.onsets(0, 1).length, 3);
});

test('cola de evaluación: un await colgado no bloquea para siempre y la carga de samples no frena la siguiente', async () => {
  assert.ok(QUEUE_WAIT_MS >= 5000);
  // 1) cuerpo colgado: la siguiente evaluación entra tras queueWait
  const hung = evaluate('await new Promise(() => {})\nd: s("bd")');
  const t0 = Date.now();
  const next = await evaluate('d: s("sn")', { queueWait: 80 });
  assert.equal(next.tracks[0].pattern.onsets(0, 1)[0].value.s, 'sn');
  assert.ok(Date.now() - t0 < 2000);
  void hung;
  // 2) samples lentos: el cuerpo ya terminó, así que la siguiente no espera a la descarga
  let release;
  const slow = evaluate('samples("lento")\nd: s("bd")', { samples: () => new Promise((r) => (release = r)), queueWait: 5000 });
  const t1 = Date.now();
  const fast = await evaluate('d: s("cp")', { queueWait: 5000 });
  assert.ok(Date.now() - t1 < 1000, 'no esperó a la descarga');
  assert.equal(fast.tracks[0].pattern.onsets(0, 1)[0].value.s, 'cp');
  release();
  const slowRes = await slow;
  assert.equal(slowRes.tracks[0].pattern.onsets(0, 1)[0].value.s, 'bd');
});

// ---------------- samples ----------------
test('samples: descargas con plazo y precarga que informa de los fallos', async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (url, opts) =>
      new Promise((resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    await assert.rejects(fetchWithTimeout('http://x/colgado.wav', (r) => r.arrayBuffer(), 60), /Tiempo de espera agotado/);
    // el cuerpo también cuenta para el plazo
    globalThis.fetch = async () => ({ ok: true, arrayBuffer: () => new Promise(() => {}) });
    await assert.rejects(fetchWithTimeout('http://x/cuerpo.wav', (r) => r.arrayBuffer(), 60), /Tiempo de espera agotado/);
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    const bank = new SampleBank({ decodeAudioData: async () => ({ duration: 1 }) });
    await bank.load({ uno: ['a.wav'], dos: ['b.wav'] }, 'base/');
    const failed = await bank.preload(new Map([['uno', new Set([0])], ['dos', new Set([{ n: 0, note: null }])]]));
    assert.equal(failed.length, 2);
    assert.ok(failed.every((f) => /HTTP 404/.test(f.message)));
    assert.deepEqual(failed.map((f) => f.name).sort(), ['dos', 'uno']);
    await assert.rejects(new SampleBank({}).load('http://x/strudel.json'), /No se pudo leer http:\/\/x\/strudel\.json \(HTTP 404\)/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------------- biblioteca ----------------
function tempTracksDir() {
  const dir = tmpDir('pulso-r2-');
  fs.writeFileSync(path.join(dir, 'styles.js'), "export const STYLE_NAMES = { liquid: 'Liquid', dark: 'Dark' };\n");
  return dir;
}

test('saveTrack: CRLF (antes podía borrar el tema), estilos válidos y metadatos conservados', async () => {
  const dir = tempTracksDir();
  await saveTrack(dir, { id: 'uno', title: 'Uno', style: 'dark', description: 'Mi descripción', code: 'bpm(174)\nd: s("bd*4")' });
  // sobrescribir con finales de línea de Windows: se guarda normalizado y el tema sigue ahí
  const crlf = 'bpm(174)\r\nd: s("bd*4 sn")\r\n';
  const r = await saveTrack(dir, { id: 'uno', code: crlf }, { overwrite: true });
  assert.equal(r.id, 'uno');
  const mod = await import(`${pathToFileURL(path.join(dir, 'uno.js')).href}?v=${Date.now()}`);
  assert.equal(mod.default.code, normalizeCode(crlf));
  assert.equal(mod.default.style, 'dark', 'se conserva el estilo');
  assert.equal(mod.default.title, 'Uno', 'se conserva el título');
  assert.equal(mod.default.description, 'Mi descripción', 'se conserva la descripción');
  await assert.rejects(saveTrack(dir, { id: 'dos', style: 'polka', code: 'd: s("bd")' }), /Estilo desconocido "polka".*liquid, dark/);
  await assert.rejects(saveTrack(dir, { id: 'tres', code: 'const a = `x`\nd: s("bd")' }), /backticks/);
  await assert.rejects(saveTrack(dir, { id: 'tres', code: 'd: s("bd").gain("${1}")' }), /backticks/);
  await assert.rejects(saveTrack(dir, { id: 'tres', code: '   ' }), /no tiene código/);
  assert.equal(fs.existsSync(path.join(dir, 'tres.js')), false);
});

test('saveTrack: con errores nunca, con avisos sólo forzando; el anterior se conserva', async () => {
  const dir = tempTracksDir();
  await saveTrack(dir, { id: 'bueno', code: 'd: s("bd")' });
  const before = fs.readFileSync(path.join(dir, 'bueno.js'), 'utf8');
  await assert.rejects(saveTrack(dir, { id: 'bueno', code: 'd: s("bd").fsat(2)' }, { overwrite: true }), /errores/);
  assert.equal(fs.readFileSync(path.join(dir, 'bueno.js'), 'utf8'), before, 'el tema anterior sigue intacto');
  const warnCode = 'const F = form("a:2 b:2")\nx: F({ a: s("bd*4") })';
  const err = await saveTrack(dir, { id: 'aviso', code: warnCode }).catch((e) => e);
  assert.ok(Array.isArray(err.warnings) && err.warnings.length > 0, 'devuelve los avisos');
  assert.equal(fs.existsSync(path.join(dir, 'aviso.js')), false);
  const forced = await saveTrack(dir, { id: 'aviso', code: warnCode }, { force: true });
  assert.ok(forced.warnings.length > 0);
  assert.ok(fs.existsSync(path.join(dir, 'aviso.js')));
});

test('writeIndex: un tema roto queda fuera (y se avisa) en vez de vaciar la biblioteca', async () => {
  const dir = tempTracksDir();
  fs.writeFileSync(path.join(dir, 'bien.js'), trackModuleSource({ id: 'bien', title: 'Bien', style: 'liquid', description: '', code: 'd: s("bd")' }));
  fs.writeFileSync(path.join(dir, 'roto.js'), 'export default { id: "roto", code: `sin cerrar ');
  fs.writeFileSync(path.join(dir, 'sincode.js'), 'export default { id: "x" };\n');
  const skipped = [];
  assert.equal(await writeIndex(dir, { onSkip: (f, why) => skipped.push(f) }), 1);
  assert.deepEqual(skipped.sort(), ['roto.js', 'sincode.js']);
  const idx = await import(`${pathToFileURL(path.join(dir, 'index.js')).href}?v=${Date.now()}`);
  assert.deepEqual(idx.TRACKS.map((t) => t.id), ['bien']);
  // al arreglarlo vuelve a entrar (la caché se renueva al cambiar el archivo)
  fs.writeFileSync(path.join(dir, 'roto.js'), trackModuleSource({ id: 'roto', title: 'Roto', style: 'liquid', description: '', code: 'd: s("sn")' }));
  assert.equal(await writeIndex(dir), 2);
});

test('análisis aislado: un bucle infinito no cuelga el servidor', async () => {
  const ok = await analyzeIsolated('bpm(174)\nd: s("bd*4")');
  assert.equal(ok.ok, true);
  const t0 = Date.now();
  await assert.rejects(analyzeIsolated('while (true) {}', 400), /bucle infinito/);
  assert.ok(Date.now() - t0 < 5000);
});

// ---------------- servidor real (carpetas temporales) ----------------
function startServer(port, env) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), ...env } });
    let out = '';
    const timer = setTimeout(() => reject(new Error(`el servidor no arrancó: ${out}`)), 8000);
    proc.stdout.on('data', (d) => {
      out += d;
      if (out.includes('Pulso en')) {
        clearTimeout(timer);
        resolve(proc);
      }
    });
    proc.stderr.on('data', (d) => (out += d));
    proc.on('exit', (code) => reject(new Error(`el servidor salió (${code}): ${out}`)));
  });
}
function sseEvents(url, signal) {
  const events = [];
  (async () => {
    try {
      const res = await fetch(url, { signal });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value);
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
        }
      }
    } catch {
      /* abortado */
    }
  })();
  return events;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('servidor: byte nulo, biblioteca con avisos (409 → force) y carpeta live/ sustituida', async (t) => {
  const port = 5900 + Math.floor(Math.random() * 300);
  const tracks = tempTracksDir();
  const live = tmpDir('pulso-live-');
  const proc = await startServer(port, { PULSO_TRACKS: tracks, PULSO_LIVE: live, PULSO_ANALYZE_MS: '1500' });
  const ctrl = new AbortController();
  t.after(() => {
    ctrl.abort();
    proc.kill();
  });
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}/%00`)).status, 400);
  assert.equal((await fetch(`${base}/index.html%00.js`)).status, 400);
  assert.equal((await fetch(`${base}/`)).status, 200, 'sigue vivo');
  // /live/ sale de su carpeta (aquí, la temporal) y no deja escapar
  fs.writeFileSync(path.join(live, 'hola.js'), 'hola()');
  assert.equal(await (await fetch(`${base}/live/hola.js`)).text(), 'hola()');
  assert.ok([403, 404].includes((await fetch(`${base}/live/..%2fserver.js`)).status));
  // biblioteca: errores → 400, avisos → 409, forzado → 200
  const lib = (q, body) => fetch(`${base}/__library?${q}`, { method: 'POST', body });
  let r = await lib('id=malo&style=liquid', 'd: s("bd").fsat(2)');
  assert.equal(r.status, 400);
  assert.ok((await r.json()).errors.length);
  const warnCode = 'const F = form("a:2 b:2")\nx: F({ a: s("bd*4") })';
  r = await lib('id=avisos&style=liquid', warnCode);
  assert.equal(r.status, 409);
  assert.ok((await r.json()).warnings.length);
  r = await lib('id=avisos&style=liquid&force=1', warnCode);
  assert.equal(r.status, 200);
  assert.ok(fs.existsSync(path.join(tracks, 'avisos.js')));
  r = await lib('id=lento&style=liquid', 'while (true) {}');
  assert.equal(r.status, 400, 'un bucle infinito no cuelga el servidor');
  assert.equal((await fetch(`${base}/`)).status, 200);
  // carpeta live/ borrada y creada de nuevo: el servidor vuelve a vigilarla
  const events = sseEvents(`${base}/__events`, ctrl.signal);
  await sleep(300);
  let replaced = true;
  try {
    fs.rmSync(live, { recursive: true, force: true });
    fs.mkdirSync(live);
  } catch {
    replaced = false; // el sistema no deja borrar una carpeta vigilada: no aplica
  }
  t.diagnostic(replaced ? 'live/ borrada y creada de nuevo' : 'el sistema no deja borrar una carpeta vigilada');
  if (replaced) {
    await sleep(2600);
    fs.writeFileSync(path.join(live, 'sesion.js'), 'claude()');
    await sleep(1200);
    assert.ok(
      events.some((e) => e.type === 'change' && e.file === 'live/sesion.js' && e.source === 'disk'),
      JSON.stringify(events),
    );
  }
});
