// Validación de toda la biblioteca de temas y del generador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TRACKS, STYLE_NAMES } from '../tracks/index.js';
import { trackFiles } from '../src/tools/indexer.js';
import { generateTrack, GEN_STYLES } from '../src/gen/generator.js';
import { evaluate } from '../src/core/eval.js';
import { validateSong, assertSplitInvariant, ev } from './helpers.js';
import { rng } from '../src/gen/generator.js';

test('biblioteca: todos los archivos de tracks/ están en el índice', () => {
  const files = trackFiles(fileURLToPath(new URL('../tracks/', import.meta.url)));
  const indexed = fs.readFileSync(new URL('../tracks/index.js', import.meta.url), 'utf8');
  for (const f of files) assert.ok(indexed.includes(`'./${f}'`), `tracks/${f} no está en tracks/index.js (node tools/pulso.js index)`);
  assert.equal(files.length, TRACKS.length);
});

test('biblioteca: metadatos', () => {
  assert.ok(TRACKS.length >= 10);
  const ids = TRACKS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'ids únicos');
  for (const t of TRACKS) {
    assert.ok(t.title && t.description && t.code, t.id);
    assert.ok(STYLE_NAMES[t.style], `${t.id}: estilo ${t.style}`);
    assert.ok(!t.code.includes('`'), `${t.id}: no debe tener backticks`);
  }
});

for (const t of TRACKS) {
  test(`tema "${t.title}": evalúa, suena en cada sección y es consistente`, async () => {
    const { res, cycles } = await validateSong(t.code, t.id);
    assert.ok(res.form, 'tiene forma');
    assert.ok(cycles >= 32, 'dura al menos 32 compases');
    // cada sección tiene algo sonando
    let start = 0;
    for (const sec of res.form.sections) {
      const n = res.tracks.reduce((a, tr) => a + tr.pattern.onsets(start, start + sec.length).length, 0);
      assert.ok(n > 0, `sección ${sec.name} en silencio`);
      start += sec.length;
    }
    // consultas en ventanas tipo scheduler = consulta entera (en toda la canción)
    const r = rng(t.id.length * 31);
    for (const tr of res.tracks) assertSplitInvariant(tr.pattern, cycles, r.next, `${t.id}/${tr.name}`);
    // determinista entre evaluaciones
    const res2 = await evaluate(t.code);
    for (let i = 0; i < res.tracks.length; i++) assert.deepEqual(ev(res.tracks[i].pattern, 0, cycles), ev(res2.tracks[i].pattern, 0, cycles));
    // las pistas de bajo están en registro grave
    for (const tr of res.tracks.filter((x) => /bass|sub/.test(x.name))) {
      for (const h of tr.pattern.onsets(0, cycles)) {
        if (h.value.note != null) assert.ok(h.value.note >= 26 && h.value.note <= 52, `${t.id}/${tr.name}: nota ${h.value.note}`);
      }
    }
  });
}

test('generador: determinista, variado y estilos válidos', () => {
  const a = generateTrack({ style: 'liquid', seed: 42 });
  assert.equal(a.code, generateTrack({ style: 'liquid', seed: 42 }).code);
  const codes = new Set();
  // se ignoran los comentarios (llevan la semilla): tiene que variar la MÚSICA
  const body = (c) => c.split('\n').filter((l) => !l.startsWith('//')).join('\n');
  for (let seed = 1; seed <= 100; seed++) codes.add(body(generateTrack({ style: 'neuro', seed }).code));
  assert.ok(codes.size >= 95, `sólo ${codes.size} distintos de 100`);
  assert.throws(() => generateTrack({ style: 'polka' }), /Estilo desconocido/);
  assert.notEqual(body(generateTrack({ style: 'liquid', seed: 1 }).code), body(generateTrack({ style: 'jungle', seed: 1 }).code));
  // marcas de estilo: cada estilo suena a lo suyo
  assert.match(generateTrack({ style: 'neuro', seed: 5 }).code, /wob\(/);
  assert.match(generateTrack({ style: 'jungle', seed: 5 }).code, /brk:0/);
  assert.match(generateTrack({ style: 'halftime', seed: 5 }).code, /b808/);
});

for (const style of Object.keys(GEN_STYLES)) {
  test(`generador "${style}": 80 semillas producen temas válidos`, async () => {
    for (let seed = 1; seed <= 80; seed++) {
      const g = generateTrack({ style, seed: seed * 37 });
      const { res } = await validateSong(g.code, `${style}#${seed * 37}`);
      assert.ok(res.form && res.form.cycles >= 40);
      assert.ok(g.title.length > 3 && g.key);
    }
  });
}
