// Herramientas de biblioteca (índice, guardado) y servidor (integración real con un proceso aparte).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { slugify, trackModuleSource, writeIndex, saveTrack, trackFiles } from '../src/tools/indexer.js';

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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tempTracksDir() {
  const dir = tmpDir('pulso-tracks-');
  fs.writeFileSync(path.join(dir, 'styles.js'), "export const STYLE_NAMES = { liquid: 'Liquid', mio: 'Mi estilo' };\n");
  return dir;
}

test('slugify y fuente de un tema con backticks, ${ y barras', async () => {
  assert.equal(slugify('Lluvia de Neón!!'), 'lluvia-de-neon');
  assert.equal(slugify('   '), '');
  const code = 'const a = `x ${1}` \\ "y"\nd: s("bd")';
  const dir = tempTracksDir();
  const file = path.join(dir, 'raro.js');
  fs.writeFileSync(file, trackModuleSource({ id: 'raro', title: 'Raro', style: 'liquid', description: 'd', code }));
  const mod = await import(`${pathToFileURL(file).href}?v=1`);
  assert.equal(mod.default.code, code, 'el código sobrevive al guardado tal cual');
});

test('writeIndex: identificadores seguros (void, class, tema-1 + tema1) y estilos preservados', async () => {
  const dir = tempTracksDir();
  for (const id of ['void', 'class', 'tema-1', 'tema1']) {
    fs.writeFileSync(path.join(dir, `${id}.js`), trackModuleSource({ id, title: id, style: 'mio', description: '', code: 'd: s("bd")' }));
  }
  assert.equal(await writeIndex(dir), 4);
  const idx = await import(`${pathToFileURL(path.join(dir, 'index.js')).href}?v=2`);
  assert.equal(idx.TRACKS.length, 4);
  assert.equal(idx.STYLE_NAMES.mio, 'Mi estilo', 'styles.js no se toca');
  // el orden existente se conserva y los nuevos van al final
  fs.writeFileSync(path.join(dir, 'aaa.js'), trackModuleSource({ id: 'aaa', title: 'aaa', style: 'liquid', description: '', code: 'd: s("bd")' }));
  await writeIndex(dir);
  const idx2 = await import(`${pathToFileURL(path.join(dir, 'index.js')).href}?v=3`);
  assert.equal(idx2.TRACKS[idx2.TRACKS.length - 1].id, 'aaa');
  assert.deepEqual(trackFiles(dir).includes('styles.js'), false);
});

test('saveTrack: no pisa sin permiso, rechaza ids vacíos o reservados', async () => {
  const dir = tempTracksDir();
  const r = await saveTrack(dir, { id: 'Mi Tema', title: 'Mi Tema', style: 'liquid', code: 'd: s("bd")' });
  assert.equal(r.id, 'mi-tema');
  await assert.rejects(saveTrack(dir, { id: 'mi tema', code: 'x' }), /Ya existe/);
  await saveTrack(dir, { id: 'mi tema', code: 'd: s("sn")' }, { overwrite: true });
  await assert.rejects(saveTrack(dir, { id: '!!!', code: 'x' }), /id o un título/);
  await assert.rejects(saveTrack(dir, { id: 'index', code: 'x' }), /reservado/);
});

// ---------------- servidor real ----------------
function startServer(port, env = {}) {
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

test('servidor: URLs malformadas, traversal, guardado y eco por contenido', async (t) => {
  const port = 5600 + Math.floor(Math.random() * 300);
  // live/ temporal: el test no escribe en la carpeta de sesión real (la biblioteca real sólo se lee)
  const liveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-live-eco-'));
  const proc = await startServer(port, { PULSO_LIVE: liveDir });
  const base = `http://127.0.0.1:${port}`;
  const liveFile = path.join(liveDir, 'test-eco.js');
  t.after(() => {
    proc.kill();
    try {
      fs.rmSync(liveDir, { recursive: true, force: true });
    } catch {
      /* ya borrado */
    }
  });
  // malformada: 400 y el servidor sigue vivo
  assert.equal((await fetch(`${base}/%`)).status, 400);
  assert.equal((await fetch(`${base}/%E0%A4%A`)).status, 400);
  assert.equal((await fetch(`${base}/`)).status, 200, 'sigue respondiendo');
  // traversal
  const trav = await fetch(`${base}/..%2f..%2fwindows%2fwin.ini`);
  assert.ok([403, 404].includes(trav.status));
  // listado de temas sin index.js ni styles.js
  const list = await (await fetch(`${base}/__tracks`)).json();
  assert.ok(list.length >= 10 && list.every((x) => !['index.js', 'styles.js'].includes(x.file)));
  // guardado: nombres inválidos y origen ajeno rechazados
  assert.equal((await fetch(`${base}/__save?file=../x.js`, { method: 'POST', body: 'x' })).status, 400);
  assert.equal((await fetch(`${base}/__save?file=a.js`, { method: 'POST', body: 'x', headers: { Origin: 'https://evil.example' } })).status, 403);
  // eco por contenido: lo que guarda el navegador llega como 'browser'; un cambio de disco, como 'disk'
  const events = [];
  const ctrl = new AbortController();
  const sse = await fetch(`${base}/__events`, { signal: ctrl.signal });
  const reader = sse.body.getReader();
  (async () => {
    const dec = new TextDecoder();
    let buf = '';
    try {
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
  await new Promise((r) => setTimeout(r, 300));
  const save = await fetch(`${base}/__save?file=test-eco.js`, { method: 'POST', body: 'navegador()' });
  assert.equal(save.status, 200);
  await new Promise((r) => setTimeout(r, 700));
  fs.writeFileSync(liveFile, 'claude()'); // llega enseguida después: NO debe confundirse con eco
  await new Promise((r) => setTimeout(r, 900));
  ctrl.abort();
  const changes = events.filter((e) => e.type === 'change' && e.file === 'live/test-eco.js');
  assert.ok(changes.some((e) => e.source === 'browser'), JSON.stringify(changes));
  assert.equal(changes[changes.length - 1].source, 'disk', JSON.stringify(changes));
  assert.ok(events.some((e) => e.type === 'hello'));
});
