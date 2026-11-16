// Regresiones de la revisión multi-agente: cada test fija un fallo confirmado y ya corregido.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/core/index.js';
import { evaluate, transpile } from '../src/core/eval.js';
import { Scheduler } from '../src/core/scheduler.js';
import { resolveVoice, sampleRate, MIN_SUB_LAYER_HZ } from '../src/audio/params.js';
import { SampleBank } from '../src/audio/samples.js';
import { SOUND_NAMES } from '../src/audio/drums.js';
import { analyzeSong } from '../src/tools/analyze.js';
import { ev, vals, assertSplitInvariant, assertWellFormed } from './helpers.js';

const { mini, s, n, note, chord, arrange, form, polymeter, polymeterSteps, pure, silence, MiniError } = P;
const names = (pat, b = 0, e = 1) => ev(pat, b, e).map((x) => x[2]);

// ---------------- patrones ----------------
test('arrange/form con secciones fraccionarias: fill de medio compás y fase correcta en cada vuelta', () => {
  const a = arrange([0.5, mini('cp*2')], [1, mini('bd sn')]);
  // la sección de medio compás toca la primera mitad de su patrón (un cp) y la siguiente empieza en 1/2
  assert.deepEqual(ev(a, 0, 3), [
    ['0', '1/2', 'cp'], ['1/2', '1', 'bd'], ['1', '3/2', 'sn'],
    ['3/2', '2', 'cp'], ['2', '5/2', 'bd'], ['5/2', '3', 'sn'],
  ]);
  const F = form('intro:2 fill:0.5 drop:2');
  const p = F({ intro: 'i', fill: 'f', drop: mini('<d1 d2>') });
  assert.deepEqual(names(p, 0, 9), ['i', 'i', 'f', 'd1', 'd2', 'i', 'i', 'f', 'd1', 'd2']);
  assert.equal(F.at(2.25).name, 'fill');
  assert.equal(F.at(4.5).name, 'intro');
  assertSplitInvariant(p, 9, Math.random, 'form fraccionaria');
  assertWellFormed(p, 0, 9, 'form fraccionaria');
});

test('polymeter acepta mini-notación y avisa con patrones sin pasos conocidos', () => {
  assert.deepEqual(names(polymeter('c eb g', 'c2 g2')), ['c', 'c2', 'eb', 'g2', 'g', 'c2']);
  assert.equal(ev(polymeterSteps(2, 'a b c'), 0, 3).length, 6);
  assert.deepEqual(names(polymeter(['a', 'b', 'c'], 'd e')).sort(), ['a', 'b', 'c', 'd', 'd', 'e']);
  assert.throws(() => polymeter(mini('a b'), 'c d e'), /cuántos pasos/);
  assert.deepEqual(ev(polymeter()), []);
});

test('iter y chunk como Strudel con patrones que cambian por ciclo', () => {
  const it = mini('<0 4> 1 2 3').iter(4);
  assert.deepEqual(vals(it, 1, 2), [1, 2, 3, 4]);
  assert.deepEqual(vals(it, 3, 4), [3, 4, 1, 2]);
  const ch = mini('<0 8> 1 2 3').chunk(4, (x) => x.add(7));
  assert.deepEqual(vals(ch, 1, 2), [0, 8, 2, 3]);
  assert.deepEqual(vals(ch, 4, 5), [15, 1, 2, 3]);
  // fastChunk conserva la variante antigua (no repite ciclos)
  assert.deepEqual(vals(mini('a b c d').fastChunk(4, (x) => x.fmap((v) => v.toUpperCase())), 1, 2), ['a', 'B', 'c', 'd']);
});

test('euclidLegato con rotación: sin hueco al empezar y la última nota llega hasta el siguiente pulso', () => {
  const p = s('x').euclidLegato(3, 8, 2);
  const e = ev(p, 0, 1);
  assert.equal(e[0][0], '0');
  for (let i = 0; i + 1 < e.length; i++) assert.equal(e[i][1], e[i + 1][0], 'notas pegadas');
  assert.equal(e[e.length - 1][1], '1');
  const inv = ev(s('x').euclidLegato(-3, 8), 0, 2);
  assert.ok(inv.length >= 5);
  assertSplitInvariant(s('x').euclidLegato(5, 8, 3), 4, Math.random, 'euclidLegato');
});

test('linger negativo repite el final del ciclo; fastGap patroneado con 0 no rompe', () => {
  assert.deepEqual(names(mini('a b c d').linger(-0.25)), ['d', 'd', 'd', 'd']);
  assert.deepEqual(names(mini('a b c d').linger(-0.5)), ['c', 'd', 'c', 'd']);
  assert.doesNotThrow(() => mini('a b').fastGap('<0 2>').queryArc(0, 4));
  assert.deepEqual(ev(mini('a b').fastGap(0)), []);
});

test('funciones nuevas: echoWith, bite, shuffle, scramble, pick, inhabit, beat, collect, stack/cat/seq', () => {
  const e = ev(mini('a').echoWith(3, 0.25, (x, i) => x.fmap((v) => `${v}${i}`)));
  assert.deepEqual(e.map((x) => [x[0], x[2]]), [['0', 'a0'], ['1/4', 'a1'], ['1/2', 'a2']], 'como Strudel: f también en la copia 0');
  assert.deepEqual(names(mini('a b c d').bite(4, '3 2 1 0')), ['d', 'c', 'b', 'a']);
  for (let c = 0; c < 20; c++) {
    const perm = names(mini('a b c d').shuffle(4), c, c + 1);
    assert.deepEqual([...perm].sort(), ['a', 'b', 'c', 'd'], 'shuffle toca cada trozo una vez');
    const sc = names(mini('a b c d').scramble(4), c, c + 1);
    assert.equal(sc.length, 4);
    assert.ok(sc.every((x) => 'abcd'.includes(x)));
  }
  assert.deepEqual(names(mini('<0 1 5>').pick(['x', 'y', 'z']), 0, 3), ['x', 'y', 'z']);
  assert.deepEqual(names(mini('<a b>').pick({ a: mini('k k'), b: 'l' }), 0, 2), ['k', 'k', 'l']);
  assert.throws(() => mini('q').pick({ a: 'x' }).queryArc(0, 1), /no existe la clave/);
  assert.deepEqual(names(mini('0 1').inhabit([mini('a b'), mini('c')])), ['a', 'b', 'c']);
  assert.deepEqual(ev(s('bd').beat('0,7,10', 16)).map((x) => x[0]), ['0', '7/16', '5/8']);
  const col = note('[c3,e3,g3]').collect().queryArc(0, 1);
  assert.equal(col.length, 1);
  assert.deepEqual(col[0].value.map((v) => v.note), [48, 52, 55]);
  assert.equal(ev(s('bd').stack(s('hh*2'))).length, 3);
  assert.deepEqual(names(mini('a').cat('b'), 0, 2), ['a', 'b']);
  assert.deepEqual(names(mini('a').seq('b')), ['a', 'b']);
});

// ---------------- mini-notación ----------------
test('mini-notación: espacios Unicode y rango como un único paso', () => {
  assert.deepEqual(names(mini('bd sn')), ['bd', 'sn']);
  assert.deepEqual(names(mini('bd sn')), ['bd', 'sn']);
  assert.deepEqual(ev(mini('0 .. 3*2')).length, 8);
  assert.throws(() => mini('{a | b}'), MiniError);
});

// ---------------- teoría ----------------
test('acordes iReal habituales', () => {
  const ok = ['C-6', 'C-69', 'C-^7', 'C7#11', 'C7b13', 'C7b5', 'C7alt', 'C+7', 'Ch9', 'C9sus', 'Cm9b5', 'C-add9', 'C2', 'C13#11', 'C13b9', 'CM13', 'Cadd11', 'Cm7b9', 'Caug7', 'Cmaj9#11', 'C^9', 'CΔ7', 'Cø', 'Co7', 'C-7b5', 'C7b9sus', 'Cmb6'];
  for (const c of ok) assert.doesNotThrow(() => P.parseChord(c), c);
  assert.deepEqual(P.parseChord('C-^7').intervals, [0, 3, 7, 11]);
  assert.deepEqual(P.parseChord('C^').intervals, [0, 4, 7, 11]);
  assert.deepEqual(P.parseChord('CM').intervals, [0, 4, 7]);
  assert.deepEqual(P.parseChord('Ch7').intervals, [0, 3, 6, 10]);
  assert.throws(() => P.parseChord('Cxyz'), /desconocido/);
});

test('voicing con n (arpegio como Strudel), anchor, mode y offset; rootNotes patroneado', () => {
  const arp = vals(n('0 1 2 3').chord('C').voicing()).map((v) => v.note);
  assert.equal(arp.length, 4);
  assert.ok(arp.every((x, i) => i === 0 || x > arp[i - 1]), 'sube');
  assert.equal(arp[3] - arp[0], 12, 'n fuera de rango sube una octava');
  assert.ok(vals(n('0').chord('C').voicing()).every((v) => !('n' in v)));
  const above = vals(chord('C').anchor('c4').mode('above').voicing()).map((v) => v.note);
  assert.ok(Math.min(...above) >= 60 && Math.min(...above) < 72);
  const below = vals(chord('C').anchor('c4').voicing()).map((v) => v.note);
  assert.ok(Math.max(...below) <= 60 && Math.max(...below) > 48);
  const duck = vals(chord('C').anchor('c5').mode('duck').voicing()).map((v) => v.note);
  assert.ok(Math.max(...duck) < 72);
  const root = vals(chord('Am').anchor('c4').mode('root').voicing()).map((v) => v.note);
  assert.equal(root[0] % 12, 9);
  const off = vals(chord('C').anchor('c5').offset(1).voicing()).map((v) => v.note);
  const base = vals(chord('C').anchor('c5').voicing()).map((v) => v.note);
  assert.equal(off[off.length - 1], base[0] + 12, 'offset 1 = primera inversión hacia arriba');
  assert.deepEqual(vals(chord('<C Am>').rootNotes('<2 3>'), 0, 2).map((v) => v.note), [36, 57]);
  assert.doesNotThrow(() => chord('C').dict('ireal').voicing().queryArc(0, 1));
});

test('arp como Strudel sobre notas apiladas y sobre voicings', () => {
  const p = note('<[c,eb,g]!2 [c,f,ab] [d,f,ab]>').arp('0 [0,2] 1 [0,2]');
  assert.deepEqual(ev(p).map((x) => [x[0], x[2]]), [
    ['0', 'note=48'], ['1/4', 'note=48'], ['1/4', 'note=55'], ['1/2', 'note=51'], ['3/4', 'note=48'], ['3/4', 'note=55'],
  ]);
  assert.equal(ev(chord('<C Am F G>').voicing().arp('0 1 2')).length, 3);
  assert.equal(ev(mini('[c3,e3,g3]').note().arp('0 1 2')).length, 3);
  assert.equal(ev(chord('Dm9').arp('up')).length, 5);
  assertSplitInvariant(chord('<Dm9 Bb^7>').arp('<[0 2 1 3] up>'), 4, Math.random, 'arp');
});

// ---------------- controles ----------------
test('valores compuestos de Strudel con ":"', () => {
  assert.deepEqual(vals(s('bd').lpf('1000:10')), [{ s: 'bd', lpf: 1000, lpq: 10 }]);
  assert.deepEqual(vals(s('bd').hpf('200:5')), [{ s: 'bd', hpf: 200, hpq: 5 }]);
  assert.deepEqual(vals(s('bd').room('.9:4')), [{ s: 'bd', room: 0.9, size: 4 }]);
  assert.deepEqual(vals(s('bd').delay('.65:.25:.9')), [{ s: 'bd', delay: 0.65, delaytime: 0.25, delayfeedback: 0.9 }]);
  assert.deepEqual(vals(s('bd').vib('4:.2')), [{ s: 'bd', vib: 4, vibmod: 0.2 }]);
  assert.deepEqual(vals(s('bd:0:0.3')), [{ s: 'bd', n: 0, gain: 0.3 }]);
  assert.deepEqual(vals(s('bd').lpf('1000')), [{ s: 'bd', lpf: 1000 }]);
  assert.deepEqual(vals(s('bd').duck('bass:pads')), [{ s: 'bd', duck: 'bass:pads' }], 'duck no se parte');
  assert.deepEqual(vals(s('bd').duckorbit(2)), [{ s: 'bd', duck: '2' }]);
  assert.deepEqual(vals(s('bd').midi()), [{ s: 'bd', midi: 'default' }]);
  assert.deepEqual(vals(s('bd').midi('Mi sinte')), [{ s: 'bd', midi: 'Mi sinte' }]);
  assert.ok(P.NUMERIC_CONTROLS.has('lpf') && !P.NUMERIC_CONTROLS.has('duck'));
});

// ---------------- evaluador ----------------
test('evaluador: erratas, undefined, etiquetas con acentos y muteo con _', async () => {
  await assert.rejects(evaluate('const vol = 0.8\ndrums: s("bd*4").gain(vo1)'), (e) => /vo1/.test(e.message) && e.line === 2);
  await assert.rejects(evaluate('drums: undefined'), /no tiene patrón/);
  await assert.rejects(evaluate('a: s("bd")\nall(x => { x.lpf(800) })'), /undefined/);
  await assert.rejects(evaluate('define("caida", p => { p.lpf(300) })\nx: s("bd").caida()'), /undefined/);
  const r = await evaluate('batería: s("bd sn")\n_percusión: s("hh*4")\n$kick: s("bd*2")\nbajo_: note("c2")');
  assert.deepEqual(r.tracks.map((t) => [t.name, t.muted]), [['batería', false], ['percusión', true], ['kick', false], ['bajo', true]]);
  const p = await evaluate('s("bd").p("_kick")\ns("sn").p("caja")\ns("hh").p("hats_")');
  assert.deepEqual(p.tracks.map((t) => [t.name, t.muted]), [['kick', true], ['caja', false], ['hats', true]]);
});

test('evaluador: regex, ++, try/catch, métodos sobre cadenas y register como Strudel', async () => {
  const r = await evaluate('const sep = /\\s+/\ndrums: s("bd*4")\nconst q = "a".replace(/"/g, "")\nbass: note("c2")');
  assert.deepEqual(r.tracks.map((t) => t.name), ['drums', 'bass']);
  assert.deepEqual((await evaluate('let k = 0\nk++\nd: s("bd")')).tracks.map((t) => t.name), ['d']);
  assert.deepEqual((await evaluate('try {\n  x = 1\n}\ncatch (e) {\n  print(e)\n}\nd: s("bd")')).tracks.map((t) => t.name), ['d']);
  const sm = await evaluate('n("0 [2 4]".add("<0 3>")).s("pluck")');
  assert.equal(ev(sm.tracks[0].pattern).length, 3);
  assert.equal(transpile('x: "a b".fast(2)'), '__track("x", false, mini("a b").fast(2))');
  assert.equal(transpile('x: "a b".split(" ")'), '__track("x", false, "a b".split(" "))', 'métodos de String no se tocan');
  const reg = await evaluate('register("rlpf", (x, pat) => pat.lpf(x))\nd: s("bd*2").rlpf("<300 600>")');
  assert.deepEqual(vals(reg.tracks[0].pattern, 1, 2).map((v) => v.lpf), [600, 600]);
  await assert.rejects(evaluate('register("fast", (x, pat) => pat)'), /ya existe/);
  assert.equal(ev(s('bd sn').fast(2)).length, 4, 'fast sigue intacto');
  assert.equal((await evaluate('setCps(0.5)\ns("bd")')).bpm, 120);
  assert.equal((await evaluate('setCpm(43.5)\ns("bd")')).bpm, 174);
  const user = await evaluate('print(typeof register, typeof sequenceArgs === "undefined" ? "oculto" : "visible")').catch((e) => e);
  assert.ok(user instanceof Error || !/visible/.test(user.logs.join()), 'lo interno no se expone');
});

test('evaluador: duplicados, errores en secciones posteriores y líneas de error', async () => {
  const d = await evaluate('bass: s("bd")\nbass: s("sn")');
  assert.deepEqual(d.duplicates, ['bass']);
  const late = await evaluate('const F = form("intro:4 drop:4")\npads: F({ drop: chord("<C^7 Cxyz>").voicing() })');
  assert.equal(late.errors.length, 1);
  assert.match(late.errors[0].message, /sección drop, compás 6/);
  await assert.rejects(evaluate('drums: s("bd [sn [hh <cp")'), (e) => e.line === 1);
  await assert.rejects(evaluate('bpm(170)\ndrums: s("bd")\nbass: note("c2"))'), (e) => e.line === 3 && /sintaxis/.test(e.message));
});

test('evaluador: evaluaciones concurrentes no mezclan sus pistas (.p)', async () => {
  const [a, b] = await Promise.all([
    evaluate('await samples({})\ns("bd").p("uno")'),
    evaluate('s("sn").p("dos")'),
  ]);
  assert.deepEqual(a.tracks.map((t) => t.name), ['uno']);
  assert.deepEqual(b.tracks.map((t) => t.name), ['dos']);
});

// ---------------- scheduler ----------------
test('scheduler: un error en un compás sólo calla ese compás y se avisa una vez', () => {
  let now = 0;
  const fired = [];
  const errors = [];
  const sch = new Scheduler({ getTime: () => now, onTrigger: (e) => fired.push(e), onError: (e) => errors.push(e), setTimer: () => 1, clearTimer: () => {} });
  sch.setTracks([{ name: 'a', pattern: s('bd').fast('<1 x 1 1>') }]);
  sch.cps = 1;
  sch.start(0);
  for (let i = 0; i < 200; i++) {
    now += 0.025;
    sch.tick();
  }
  assert.equal(errors.length, 1);
  const cycles = new Set(fired.map((e) => Math.floor(e.cycle)));
  assert.ok(cycles.has(0) && cycles.has(2) && cycles.has(3) && !cycles.has(1), [...cycles].join(','));
});

test('scheduler: pistas ocultas por solo siguen disparando su sidechain (duckOnly)', () => {
  let now = 0;
  const fired = [];
  const sch = new Scheduler({ getTime: () => now, onTrigger: (e) => fired.push(e), setTimer: () => 1, clearTimer: () => {} });
  sch.setTracks([
    { name: 'kick', pattern: s('bd*4').duck('bass'), duckOnly: true },
    { name: 'bass', pattern: note('c2') },
  ]);
  sch.start(0);
  for (let i = 0; i < 100; i++) {
    now += 0.03;
    sch.tick();
  }
  assert.ok(fired.some((e) => e.track === 'kick' && e.duckOnly));
  assert.ok(fired.some((e) => e.track === 'bass' && !e.duckOnly));
});

// ---------------- parámetros de voz ----------------
test('parámetros: delay sin autooscilación, ADSR de samples, duck como Strudel, tono base 36', () => {
  assert.equal(resolveVoice({ s: 'rim', delay: 0.8, delayfeedback: 0.99 }).delayfeedback, 0.9);
  assert.equal(resolveVoice({ s: 'oh' }).env, false);
  assert.equal(resolveVoice({ s: 'oh', decay: 0.1 }).env, true);
  assert.equal(resolveVoice({ s: 'oh', decay: 0.1 }).sustain, 0);
  const d = resolveVoice({ s: 'bd', duck: '2', duckonset: 0.01, duckattack: 0.3 });
  assert.deepEqual(d.duck, ['2']);
  assert.equal(d.duckonset, 0.01);
  assert.equal(d.duckrecover, 0.3, 'duckattack = tiempo de vuelta (como Strudel)');
  assert.equal(resolveVoice({ s: 'bd', duck: 'x', duckrelease: 0.25 }).duckrecover, 0.25);
  assert.equal(resolveVoice({ s: 'bd', orbit: 2 }).orbit, 2);
  assert.equal(resolveVoice({ s: 'saw', ftype: 'ladder' }).ftype, '24db');
  assert.equal(resolveVoice({ s: 'saw', coarse: 8 }).coarse, 8);
  assert.equal(resolveVoice({ s: 'bd', midi: 'default' }).midi, 'default');
  assert.equal(sampleRate(resolveVoice({ s: 'bd' }), 1), 1);
  assert.ok(MIN_SUB_LAYER_HZ >= 25);
  assert.ok(SOUND_NAMES.includes('sd') && SOUND_NAMES.includes('tb') && SOUND_NAMES.includes('misc'));
});

// ---------------- banco de samples (sin red) ----------------
test('banco de samples: mapas por nota, nota más cercana y reintentos con espera', async () => {
  const bank = new SampleBank({ decodeAudioData: async () => ({ duration: 1 }) });
  await bank.load({ piano: { a0: 'A0.mp3', c4: ['C4a.mp3', 'C4b.mp3'] }, bd: ['bd1.wav', 'bd2.wav'] }, 'base/');
  assert.deepEqual(bank.pick('piano', 0, 60), { url: 'base/C4a.mp3', baseNote: 60 });
  assert.deepEqual(bank.pick('piano', 1, 58), { url: 'base/C4b.mp3', baseNote: 60 });
  assert.deepEqual(bank.pick('piano', 0, 25), { url: 'base/A0.mp3', baseNote: 21 });
  assert.deepEqual(bank.pick('bd', 3), { url: 'base/bd2.wav', baseNote: 36 });
  let calls = 0;
  const errors = [];
  bank.onError = (url) => errors.push(url);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return { ok: false, status: 404 };
  };
  try {
    for (let i = 0; i < 5; i++) await bank.loadUrl('base/bd1.wav').catch(() => {});
    for (let i = 0; i < 5; i++) bank.resolve('bd', 0);
    await new Promise((r) => setTimeout(r, 10));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls, 1, 'una URL que falla no se vuelve a pedir en cada golpe');
  assert.equal(errors.length, 1, 'se avisa una sola vez');
});

// ---------------- analizador ----------------
test('analizador: duplicados, pistas mudas, samples externos, texto en controles numéricos y bajos muy graves', async () => {
  assert.ok((await analyzeSong('bass: s("bd")\nbass: s("sn")')).errors.some((e) => /definida dos veces/.test(e)));
  const muted = await analyzeSong('const F = form("a:2 b:2")\nx: F({ a: s("bd*4") })\n_y: F({ b: s("sn*4") })');
  assert.ok(muted.warnings.some((w) => /sección "b" está en silencio/.test(w)));
  const ext = await analyzeSong('samples({ mibombo: ["k.wav"] })\nd: s("mibombo*4")');
  assert.ok(ext.ok, ext.errors.join());
  assert.ok(ext.warnings.some((w) => /mibombo/.test(w)));
  assert.ok(!(await analyzeSong('d: s("mibombo*4")')).ok, 'sin samples() un sonido desconocido es error');
  const txt = await analyzeSong('d: s("bd*4").lpf("<x 800>")');
  assert.ok(txt.errors.some((e) => /lpf recibió "x"/.test(e)));
  const low = await analyzeSong('bass: note("c1*4").s("sub")\nsub: note("e1").s("saw").subosc(.5)');
  assert.ok(low.warnings.some((w) => /bass.*D1/.test(w)));
  assert.ok(low.warnings.some((w) => /sub-octava/.test(w)));
  const orbit = await analyzeSong('k: s("bd*4").duckorbit(2)\nb: note("c2").s("sub").orbit(2)');
  assert.ok(orbit.ok, orbit.errors.join());
  const badOrbit = await analyzeSong('k: s("bd*4").duckorbit(3)\nb: note("c2").s("sub").orbit(2)');
  assert.ok(badOrbit.errors.some((e) => /duck\("3"\)/.test(e)));
});

test('silencio y pure siguen intactos', () => {
  assert.deepEqual(ev(silence, 0, 4), []);
  assert.equal(ev(pure(1), 0, 4).length, 4);
});
