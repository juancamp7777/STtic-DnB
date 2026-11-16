// Regresiones de la tercera revisión (verificación adversarial de la ronda 2): cada test fija un fallo confirmado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as P from '../src/core/index.js';
import { evaluate } from '../src/core/eval.js';
import { Scheduler } from '../src/core/scheduler.js';
import { envelopeValueAt } from '../src/audio/params.js';
import { scheduleADSR } from '../src/audio/voice.js';
import { encodeWav } from '../src/audio/wav.js';
import { SampleBank } from '../src/audio/samples.js';
import { Engine } from '../src/audio/engine.js';
import { analyzeSong } from '../src/tools/analyze.js';
import { saveTrack, writeIndex, trackModuleSource, analyzeIsolated } from '../src/tools/indexer.js';
import { assertSplitInvariant, assertWellFormed } from './helpers.js';

const { mini, pure, s, n } = P;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const val = (v) => (v && typeof v === 'object' ? v.s ?? JSON.stringify(v) : String(v));
const at = (pat, b = 0, e = 1) => pat.onsets(b, e).map((h) => `${val(h.value)}@${h.whole.begin}`);

// ---------------- beat ----------------
test('beat: con patrones da lo mismo que sin ellos (un golpe por paso con el valor del patrón, como Strudel)', () => {
  assert.deepEqual(at(s('bd hh').beat('<0 0>,10', 16)), at(s('bd hh').beat('0,10', 16)));
  assert.deepEqual(at(s('bd hh').beat('0,10', '<16 16>')), ['bd@0', 'hh@5/8']);
  assert.equal(s('hh*16').beat('<0 0>,8', 16).onsets(0, 1).length, 2, 'no mete el patrón entero en el paso');
  assert.equal(n('0 1 2 3').beat('<0 0>,4,8,12', 16).onsets(0, 1).length, 4);
  assert.deepEqual(at(s('bd').beat([0, 7, 10], '<16 16>')).map((x) => x.split('@')[1]), ['0', '7/16', '5/8'], 'un array es un conjunto');
  // fraccionarios sin redondear, igual por las dos rutas
  assert.deepEqual(at(s('bd').beat('0.5', 16)), ['bd@1/32']);
  assert.deepEqual(at(s('bd').beat('<0.5 0.5>', 16)), ['bd@1/32']);
  assert.deepEqual(at(s('bd').beat('1', 2.5)), ['bd@2/5']);
  // conjunto con patrones y rangos
  assert.deepEqual(at(s('bd').beat('0 <4 6> 10', 16), 1, 2).map((x) => x.split('@')[1]), ['1', '11/8', '13/8']);
  assert.deepEqual(at(s('bd').beat('0 .. 3', 16)).map((x) => x.split('@')[1]), ['0', '1/16', '1/8', '3/16']);
  assert.deepEqual(at(s('bd').beat('3..1,8', 16)).map((x) => x.split('@')[1]), ['1/16', '1/8', '3/16', '1/2']);
  for (const p of [s('bd hh').beat('<0 2>,10', 16), s('bd').beat('0 <4 6> 10', '<16 8>'), n('0 1').beat('<0.5 1>', 4)]) {
    assertSplitInvariant(p, 6, Math.random, 'beat');
    assertWellFormed(p, 0, 6, 'beat');
  }
});

// ---------------- Fibonacci ----------------
test('fib(): sucesión de Fibonacci como patrón, con módulo (periodo de Pisano) y argumentos patrón', async () => {
  const vals = (p, b = 0, e = 1) => p.onsets(b, e).map((h) => h.value);
  assert.deepEqual(vals(P.fib(8)), [0, 1, 1, 2, 3, 5, 8, 13]);
  assert.deepEqual(vals(P.fib(16, 7)), [0, 1, 1, 2, 3, 5, 1, 6, 0, 6, 6, 5, 4, 2, 6, 1]);
  // módulo 7 la sucesión se repite exactamente cada 16 números (periodo de Pisano de 7)
  const l = P.fibonacciList(48, 7);
  assert.deepEqual(l.slice(16, 32), l.slice(0, 16));
  assert.deepEqual(l.slice(32, 48), l.slice(0, 16));
  // sin módulo, 79 números exactos: F(0)...F(78) = 8944394323791464 < 2^53; F(79) ya no cabe exacto
  assert.equal(P.fibonacciList(79).at(-1), 8944394323791464);
  assert.ok(P.fibonacciList(79).at(-1) < 2 ** 53);
  assert.throws(() => P.fib(80), /como mucho 79/);
  assert.throws(() => P.fib(8, Infinity), /entre 1 y 2\^52/);
  assert.throws(() => P.fib(8, 2 ** 60), /entre 1 y 2\^52/);
  // con un módulo grande sigue siendo exacto: se compara con la sucesión calculada en BigInt
  const exact = [];
  let fa = 0n;
  let fb = 1n;
  for (let i = 0; i < 100; i++) {
    exact.push(Number(fa % 2n ** 52n));
    [fa, fb] = [fb, fa + fb];
  }
  assert.deepEqual(P.fibonacciList(100, 2 ** 52), exact, 'módulo 2^52: exacto en los 100 términos');
  assert.deepEqual(vals(P.fib('<4 8>'), 1, 2), [0, 1, 1, 2, 3, 5, 8, 13]);
  assert.deepEqual(vals(P.fib(4, '<7 2>'), 1, 2), [0, 1, 1, 0]);
  assert.throws(() => P.fib(0), /la longitud tiene que ser 1 o más/);
  assert.throws(() => P.fib(8, 0), /el módulo tiene que ser un entero entre 1 y 2\^52/);
  // como melodía: 16 semicorcheas en La menor
  const notes = P.n(P.fib(16, 7)).scale('A4:minor').onsets(0, 1).map((h) => h.value.note);
  assert.deepEqual(notes, [69, 71, 71, 72, 74, 77, 71, 79, 69, 79, 79, 77, 76, 72, 79, 71]);
  assertSplitInvariant(P.n(P.fib(16, '<7 5>')).scale('A4:minor'), 6, Math.random, 'fib');
  const r = await evaluate('k: n(fib(16, 7)).scale("A4:minor").s("pluck")\nb: s("brk:1").splice(8, fib(8, 8))');
  assert.deepEqual(r.tracks.map((t) => t.pattern.onsets(0, 1).length), [16, 8]);
});

// ---------------- aleatorio ----------------
test('undegradeBy como Strudel: deja pasar 1 - x; degradeBy(x) + undegradeBy(1 - x) se reparten sin repetir', () => {
  const p = s('hh*8');
  const kept = p.undegradeBy(0.2).onsets(0, 100).length;
  assert.ok(kept > 560 && kept < 720, `undegradeBy(.2) deja ~80 % (${kept}/800)`);
  const a = new Set(p.degradeBy(0.3).onsets(0, 100).map((h) => String(h.whole.begin)));
  const b = p.undegradeBy(0.7).onsets(0, 100).map((h) => String(h.whole.begin));
  assert.equal(a.size + b.length, 800);
  assert.ok(b.every((t) => !a.has(t)), 'ningún golpe en los dos');
  const marked = p.sometimesBy(0.3, (x) => x.fmap(() => 'X')).onsets(0, 100);
  assert.equal(marked.length, 800, 'sometimesBy no duplica ni pierde golpes');
  const frac = marked.filter((h) => h.value === 'X').length / 800;
  assert.ok(frac > 0.22 && frac < 0.38, `sometimesBy(.3) cambia ~30 % (${frac})`);
});

test('wchooseCycles: los pesos pueden ser patrones (ejemplo de la documentación de Strudel)', () => {
  const w = P.wchooseCycles([mini('bd(3,8)'), '<5 0>'], [mini('hh hh hh'), 3]);
  for (let c = 1; c < 40; c += 2) assert.equal(w.onsets(c, c + 1)[0].value, 'hh', `ciclo ${c}: bd pesa 0`);
  const firsts = new Set();
  for (let c = 0; c < 40; c += 2) firsts.add(w.onsets(c, c + 1)[0].value);
  assert.deepEqual([...firsts].sort(), ['bd', 'hh']);
  assert.equal(P.wchooseCycles([pure('a'), 0], [pure('b'), 0]).onsets(0, 4).length, 0, 'todo con peso 0 = silencio');
  assert.throws(() => P.wchooseCycles(['a']), /cada opción es \[patrón, peso\]/);
});

test('sinónimos de Strudel: chunkback, fastchunk, slowchunk, slowChunk e invert/inv como función', async () => {
  const up = (x) => x.fmap((v) => String(v).toUpperCase());
  const show = (p) => [0, 1, 2, 3].map((c) => p.onsets(c, c + 1).map((h) => h.value).join(' ')).join(' | ');
  assert.equal(show(mini('a b c d').chunkback(4, up)), show(mini('a b c d').chunkBack(4, up)));
  assert.equal(show(mini('a b c d').fastchunk(4, up)), show(mini('a b c d').fastChunk(4, up)));
  assert.equal(show(mini('a b c d').slowchunk(4, up)), show(mini('a b c d').chunk(4, up)));
  assert.equal(show(mini('a b c d').slowChunk(4, up)), show(mini('a b c d').chunk(4, up)));
  const r = await evaluate('d: s("bd").struct("1 0 0 1 0 0 1 0".lastOf(4, invert))\ne: s("hh").struct(inv("1 0"))');
  assert.equal(r.tracks[0].pattern.onsets(3, 4).length, 5, 'el último de cada 4 invierte la estructura');
  assert.equal(r.tracks[1].pattern.onsets(0, 1).length, 1);
});

test('arp: los modos ordenan también nombres de nota en texto', () => {
  const notes = (p) => p.onsets(0, 1).map((h) => h.value.note);
  assert.deepEqual(notes(mini('[e3,c3,g3]').arp('up').note()), [48, 52, 55]);
  assert.deepEqual(notes(mini('[g3,e3,c3]').arp('down').note()), [55, 52, 48]);
  assert.deepEqual(notes(mini('[e3,c3,g3]').arp('0 1 2').note()), [52, 48, 55], 'los índices respetan el orden escrito');
});

// ---------------- bucle ----------------
test('ribbon y el bucle del estudio aceptan duraciones fraccionarias (fill:0.5, tema de 6.5 compases)', () => {
  assert.deepEqual(at(mini('<a b c d>').ribbon(1, 0.5), 0, 2), ['b@0', 'b@1/2', 'b@1', 'b@3/2']);
  assert.deepEqual(at(mini('<a b c d>').ribbon(1, 2), 0, 4), ['b@0', 'c@1', 'b@2', 'c@3']);
  assert.equal(mini('<a b>').ribbon(0, 0.5).queryArc(0.25, 0.25).length, 1, 'consulta de anchura cero');
  assertSplitInvariant(mini('a [b c] <d e>').ribbon(1.5, 0.75), 8, Math.random, 'ribbon fraccionario');
  const e = new Engine();
  const F = P.form('a:4 fill:0.5 b:2');
  const pat = F({ a: s('<a1 a2 a3 a4>'), fill: s('f1 f2'), b: s('<b1 b2>') });
  e.setLoop(F.startOf('fill'), 0.5);
  assert.deepEqual(e.loop, { start: 4, length: 0.5 });
  assert.deepEqual(at(e.scheduledPattern(pat), 4, 6), ['f1@4', 'f1@9/2', 'f1@5', 'f1@11/2']);
  e.setLoop(0, F.cycles);
  assert.deepEqual(at(e.scheduledPattern(pat), 5, 8.5), ['b2@11/2', 'a1@13/2', 'a2@15/2'], 'vuelve a 0 en 6.5, sin tartamudeo');
});

// ---------------- scheduler ----------------
test('scheduler: dentro de una ventana los golpes se disparan en orden temporal (entre capas y pistas)', () => {
  let t = 0;
  const got = [];
  const sch = new Scheduler({
    getTime: () => t,
    onTrigger: (ev) => got.push(`${ev.value.s}@${ev.cycle}`),
    setTimer: () => 1,
    clearTimer: () => {},
    lookahead: 0.5,
    latency: 0,
  });
  sch.setTracks([
    { name: 'x', pattern: s('hh*16, oh*4') },
    { name: 'y', pattern: s('bd*8') },
  ]);
  sch.cps = 0.5;
  sch.start(0); // la primera ventana cubre 0.25 ciclos
  const times = got.map((g) => Number(g.split('@')[1]));
  assert.ok(got.length >= 6, got.join(' '));
  for (let i = 1; i < times.length; i++) assert.ok(times[i] >= times[i - 1], `fuera de orden: ${got.join(' ')}`);
  // a igual tiempo, el orden de pistas y capas (como el export)
  assert.deepEqual(got.slice(0, 3), ['hh@0', 'oh@0', 'bd@0']);
});

// ---------------- envolventes ----------------
test('scheduleADSR programa en orden aunque la nota sea más corta que attack + 5 ms', () => {
  const calls = [];
  const param = {
    setValueAtTime: (v, time) => calls.push([time, v, 'set']),
    linearRampToValueAtTime: (v, time) => calls.push([time, v, 'lin']),
  };
  const end = scheduleADSR(param, 0, 0.004, { attack: 0.003, decay: 0, sustain: 0.5, release: 0.001 }, 1);
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i][0] >= calls[i - 1][0], `evento fuera de orden: ${JSON.stringify(calls)}`);
  assert.ok(Math.abs(end - 0.005) < 1e-9);
  // tras el release vale 0 (antes la rampa tardía a sustain dejaba una cola fantasma)
  assert.equal(envelopeValueAt(calls, 0.02), 0);
  // envelopeValueAt ordena por tiempo como AudioParam
  const unsorted = [[0, 0, 'set'], [0.001, 1, 'lin'], [0.006, 0.5, 'lin'], [0.004, 0.5, 'set'], [0.0045, 0, 'lin']];
  assert.ok(Math.abs(envelopeValueAt(unsorted, 0.0042) - 0.3) < 1e-9);
});

// ---------------- WAV ----------------
test('WAV de 32 bits en coma flotante (stems): cabecera válida y sin recortar lo que pasa de 0 dBFS', () => {
  const buf = encodeWav([new Float32Array([0, 1.5, -2]), new Float32Array([0.25, NaN, 0])], 48000, { float: true });
  const v = new DataView(buf);
  const str = (o, len) => String.fromCharCode(...new Uint8Array(buf, o, len));
  assert.equal(str(0, 4), 'RIFF');
  assert.equal(v.getUint32(4, true), buf.byteLength - 8);
  assert.equal(str(8, 4), 'WAVE');
  assert.equal(v.getUint16(20, true), 3, 'formato IEEE float');
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint16(34, true), 32);
  assert.equal(str(38, 4), 'fact');
  assert.equal(v.getUint32(46, true), 3, 'fact = número de muestras por canal');
  assert.equal(str(50, 4), 'data');
  assert.equal(v.getUint32(54, true), 3 * 2 * 4);
  assert.equal(v.getFloat32(58 + 8, true), 1.5);
  assert.equal(v.getFloat32(58 + 12, true), 0, 'NaN se escribe como 0');
  assert.equal(v.getFloat32(58 + 16, true), -2);
  // el de 16 bits sigue igual
  const pcm = new DataView(encodeWav([new Float32Array([1, -1])], 44100));
  assert.equal(pcm.getUint16(20, true), 1);
  assert.equal(pcm.getInt16(44, true), 32767);
});

// ---------------- samples ----------------
test('samples: el mapa que llega de una evaluación obsoleta no pisa el de la que suena', async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => ({ ok: true, json: async () => ({ bd: [`${url.includes('kitA') ? 'kickA' : 'kickB'}.wav`] }) });
    const bank = new SampleBank({ decodeAudioData: async () => ({ duration: 1 }) });
    assert.equal(await bank.load('https://x/kitB/strudel.json'), 1);
    assert.equal(await bank.load('https://x/kitA/strudel.json', '', () => false), 0, 'obsoleta: no escribe');
    assert.equal(bank.pick('bd').url, 'https://x/kitB/kickB.wav');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------------- evaluador ----------------
test('cuerpos solapados: cada evaluación se queda con sus .p() y el límite de pila vuelve a su valor', async () => {
  const base = Error.stackTraceLimit;
  let open;
  globalThis.__r3gate = new Promise((r) => (open = r));
  try {
    const A = evaluate('s("bd").p("drums")\nawait __r3gate\ns("hh").p("lead")', { queueWait: 20 });
    await new Promise((r) => setTimeout(r, 5));
    const B = evaluate('s("sn").p("drums")\nawait new Promise((r) => setTimeout(r, 60))\ns("cp").p("bass")', { queueWait: 20 });
    setTimeout(() => open(), 40); // A se reanuda mientras B está a mitad
    const [a, b] = await Promise.all([A, B]);
    assert.deepEqual(a.tracks.map((t) => t.name), ['drums', 'lead']);
    assert.deepEqual(b.tracks.map((t) => t.name), ['drums', 'bass']);
    assert.deepEqual(a.duplicates, []);
    assert.deepEqual(b.duplicates, []);
  } finally {
    delete globalThis.__r3gate;
  }
  assert.equal(Error.stackTraceLimit, base);
  // un error de mini-notación sigue dando su línea aunque otro cuerpo termine en medio
  let open2;
  globalThis.__r3gate2 = new Promise((r) => (open2 = r));
  try {
    const A2 = evaluate('await __r3gate2\nd: s("bd")', { queueWait: 20 });
    await new Promise((r) => setTimeout(r, 5));
    const B2 = evaluate('await new Promise((r) => setTimeout(r, 40))\n\nd: s("bd [sn")', { queueWait: 20 });
    setTimeout(() => open2(), 25);
    const err = await B2.catch((e) => e);
    assert.equal(err.line, 3, err.message);
    await A2;
  } finally {
    delete globalThis.__r3gate2;
  }
  assert.equal(Error.stackTraceLimit, base);
});

test('métodos propios con nombre Unicode sobre una cadena', async () => {
  await evaluate('define("caídaR3", (p) => p.fast(2))\nregister("ñacaR3", (pat) => pat.fast(3))');
  const r = await evaluate('a: "bd sn".caídaR3().s()\nb: "hh".ñacaR3().s()');
  assert.equal(r.tracks[0].pattern.onsets(0, 1).length, 4);
  assert.equal(r.tracks[1].pattern.onsets(0, 1).length, 3);
});

test('variantes A/B: la reserva también se valida (evaluate y analizador)', async () => {
  const r = await evaluate('bass: note("e1*4").s("sub")\n_bass: note("e1*4").s("sub").fast("x")');
  assert.deepEqual(r.tracks.map((t) => `${t.name}:${t.muted}`), ['bass:false']);
  assert.equal(r.alternates.length, 1);
  assert.ok(r.errors.some((e) => e.track === 'bass (variante en reserva)'), JSON.stringify(r.errors));
  const rep = await analyzeSong('bpm(174)\nbass: note("e1*4").s("sub")\n_bass: note("e1*4").s("sbu")');
  assert.equal(rep.ok, false);
  assert.ok(rep.errors.some((e) => /variante en reserva.*sbu/.test(e)), rep.errors.join());
  const good = await analyzeSong('bpm(174)\nbass: note("e1*4").s("sub")\n_bass: note("g1*4").s("sub")');
  assert.ok(good.ok && good.warnings.length === 0, good.errors.concat(good.warnings).join());
});

test('línea de los errores de sintaxis con if/for sin llaves, llaves en otra línea y declaraciones repetidas', async () => {
  const line = async (code) => (await evaluate(code).then(() => null, (e) => e.line));
  assert.equal(await line('for (const x of [1, 2])\n  print(x)\nd: s("bd"))'), 3);
  assert.equal(await line('if (true)\n  print(1)\nd: s("bd"))'), 3);
  assert.equal(await line('function f()\n{\n  return 1\n}\nd: s("bd"))'), 5);
  assert.equal(await line('const F = 1\nconst G = 2\nconst F = 3'), 3);
  assert.equal(await line('d: s("bd")\ne: s("sn"))'), 2);
});

// ---------------- biblioteca ----------------
function tempDir(withStyles = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-r3-'));
  if (withStyles) fs.writeFileSync(path.join(dir, 'styles.js'), "export const STYLE_NAMES = { liquid: 'Liquid' };\n");
  return dir;
}
const importIndex = (dir) => import(`${pathToFileURL(path.join(dir, 'index.js')).href}?v=${Date.now()}-${Math.random()}`);

test('índice sin styles.js: sigue cargando (STYLE_NAMES vacío)', async () => {
  const dir = tempDir(false);
  await saveTrack(dir, { id: 'uno', code: 'd: s("bd")' });
  const idx = await importIndex(dir);
  assert.deepEqual(idx.STYLE_NAMES, {});
  assert.equal(idx.TRACKS.length, 1);
});

test('índice: un tema roto un momento vuelve a su sitio (no se va al final)', async () => {
  const dir = tempDir();
  for (const id of ['a', 'b', 'c', 'd']) fs.writeFileSync(path.join(dir, `${id}.js`), trackModuleSource({ id, title: id, style: 'liquid', description: '', code: 'd: s("bd")' }));
  await writeIndex(dir);
  fs.writeFileSync(path.join(dir, 'b.js'), 'export default { roto');
  const skipped = [];
  assert.equal(await writeIndex(dir, { onSkip: (f) => skipped.push(f) }), 3);
  assert.deepEqual(skipped, ['b.js']);
  fs.writeFileSync(path.join(dir, 'b.js'), trackModuleSource({ id: 'b', title: 'b', style: 'liquid', description: '', code: 'd: s("sn")' }));
  await writeIndex(dir);
  assert.deepEqual((await importIndex(dir)).TRACKS.map((t) => t.id), ['a', 'b', 'c', 'd']);
});

test('guardados simultáneos del mismo tema nuevo: uno se guarda y el otro recibe "Ya existe"', async () => {
  const dir = tempDir();
  const results = await Promise.allSettled([
    saveTrack(dir, { id: 'x', title: 'Primera', code: 'd: s("bd")' }),
    saveTrack(dir, { id: 'x', title: 'Segunda', code: 'd: s("sn")' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.match(results.find((r) => r.status === 'rejected').reason.message, /Ya existe/);
  const mod = await import(`${pathToFileURL(path.join(dir, 'x.js')).href}?v=${Date.now()}`);
  assert.equal(mod.default.title, 'Primera');
});

test('análisis aislado: informe con título y salida rápida si el código nunca termina', async () => {
  const ok = await analyzeIsolated('bpm(174)\nd: s("bd*4")', 10000, { label: 'mi-tema' });
  assert.ok(ok.ok);
  assert.match(ok.report, /✔ mi-tema/);
  const t0 = Date.now();
  await assert.rejects(analyzeIsolated('await new Promise(() => {})\nd: s("bd")', 8000), /terminó sin resultado/);
  assert.ok(Date.now() - t0 < 4000, 'no espera al plazo');
});

test('CLI: info/check con un bucle infinito fallan con mensaje y código 1 (no se cuelgan)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-r3-cli-'));
  const file = path.join(dir, 'bucle.js');
  fs.writeFileSync(file, 'while (true) {}\n');
  const env = { ...process.env, PULSO_ANALYZE_MS: '1500' };
  const info = spawnSync(process.execPath, ['tools/pulso.js', 'info', file], { cwd: ROOT, env, encoding: 'utf8', timeout: 20000 });
  assert.equal(info.status, 1, info.stdout + info.stderr);
  assert.match(info.stderr + info.stdout, /bucle infinito/);
  const check = spawnSync(process.execPath, ['tools/pulso.js', 'check', file], { cwd: ROOT, env, encoding: 'utf8', timeout: 20000 });
  assert.equal(check.status, 1);
  assert.match(check.stdout, /0\/1 temas válidos/);
});

// ---------------- servidor ----------------
test('servidor: /LIVE/ en mayúsculas usa la misma carpeta que /live/', async (t) => {
  const port = 6300 + Math.floor(Math.random() * 300);
  const live = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-r3-live-'));
  fs.writeFileSync(path.join(live, 'hola.js'), 'override()');
  const proc = await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), PULSO_LIVE: live, PULSO_TRACKS: tempDir() } });
    let out = '';
    const timer = setTimeout(() => reject(new Error(out)), 8000);
    p.stdout.on('data', (d) => {
      out += d;
      if (out.includes('Pulso en')) {
        clearTimeout(timer);
        resolve(p);
      }
    });
    p.on('exit', (c) => reject(new Error(`salió ${c}: ${out}`)));
  });
  t.after(() => proc.kill());
  const base = `http://127.0.0.1:${port}`;
  assert.equal(await (await fetch(`${base}/live/hola.js`)).text(), 'override()');
  assert.equal(await (await fetch(`${base}/LIVE/hola.js`)).text(), 'override()');
  assert.equal((await fetch(`${base}/Live/..%2fserver.js`)).status, 403);
  // guardados solapados de estado.json: nunca queda a medias, gana el último y no quedan temporales
  const long = JSON.stringify({ a: 'x'.repeat(5000) });
  const short = JSON.stringify({ b: 1 });
  for (let i = 0; i < 25; i++) {
    const rs = await Promise.all([long, short, long, short].map((body) => fetch(`${base}/__save?file=estado.json`, { method: 'POST', body })));
    assert.ok(rs.every((r) => r.ok));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(live, 'estado.json'), 'utf8')), { b: 1 }, `ronda ${i}`);
  }
  assert.deepEqual(fs.readdirSync(live).filter((f) => f.endsWith('.tmp')), []);
});
