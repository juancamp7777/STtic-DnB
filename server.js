// Servidor local de Pulso, sin dependencias:  node server.js  ->  http://localhost:5173
//
// Además de servir archivos, permite colaborar en vivo:
//   GET  /__events            Server-Sent Events: avisa cuando cambia algo en live/ o tracks/
//   GET  /__tracks            lista de temas en tracks/ (con fecha de modificación)
//   GET  /__live              lista de archivos de sesión en live/
//   POST /__save?file=...     guarda el código del editor en live/<archivo>.(js|json)
//   POST /__library?id=&style=&title=[&description=][&overwrite=1][&force=1]   guarda el código como tema
//        de la biblioteca (400 con errores; 409 si sólo hay avisos y no se forzó)
// Sólo escucha en loopback (127.0.0.1 y ::1) y sólo escribe dentro de live/ y tracks/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trackFiles, saveTrack, analyzeIsolated, TRACK_FILE_RE } from './src/tools/indexer.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';
// PULSO_LIVE / PULSO_TRACKS: otras carpetas (lo usan los tests para no tocar la biblioteca real)
const LIVE = process.env.PULSO_LIVE ? path.resolve(process.env.PULSO_LIVE) : path.join(ROOT, 'live');
const TRACKS = process.env.PULSO_TRACKS ? path.resolve(process.env.PULSO_TRACKS) : path.join(ROOT, 'tracks');
const MAX_BODY = 512 * 1024;
// plazo del análisis al guardar en la biblioteca (un bucle infinito en el código no cuelga el servidor)
const ANALYZE_MS = Number(process.env.PULSO_ANALYZE_MS) || 10000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

fs.mkdirSync(LIVE, { recursive: true });

// --- Server-Sent Events ---
const clients = new Set();
function broadcast(event) {
  const msg = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(msg);
}

// Eco de los guardados del navegador: se reconoce por CONTENIDO (no por tiempo), así un cambio
// externo (Claude) que llegue justo después nunca se confunde con el eco del navegador.
const browserSaves = new Map(); // 'live/sesion.js' -> texto guardado por el navegador
const debounce = new Map();

// Avisa de un cambio en <kind>/<name> (con detección de eco del navegador por contenido)
function announce(dir, kind, name) {
  const rel = `${kind}/${name}`;
  let text = null;
  let mtime = 0;
  try {
    const file = path.join(dir, name);
    mtime = fs.statSync(file).mtimeMs;
    text = fs.readFileSync(file, 'utf8');
  } catch {
    /* borrado */
  }
  const fromBrowser = text !== null && browserSaves.get(rel) === text;
  broadcast({ type: 'change', kind, file: rel, mtime, source: fromBrowser ? 'browser' : 'disk' });
}

// Vigila una carpeta. Si la carpeta se borra o se sustituye por otra (git, el explorador, un "rm -r"),
// el watcher viejo queda mudo sin avisar: se comprueba cada 2 s que sigue siendo la misma (ino) y se rehace.
function watchDir(dir, kind) {
  let watcher = null;
  let ino = null;
  let restarting = null;
  const identity = () => {
    try {
      return fs.statSync(dir).ino;
    } catch {
      return null;
    }
  };
  const start = (rescan) => {
    restarting = null;
    try {
      watcher?.close();
    } catch {
      /* ya cerrado */
    }
    watcher = null;
    try {
      fs.mkdirSync(dir, { recursive: true });
      ino = identity();
      watcher = fs.watch(dir, (type, name) => {
        // en Windows, al borrar la carpeta llegan nombres absolutos o la carpeta ya no existe
        if (!fs.existsSync(dir) || (name && path.isAbsolute(name))) return restart();
        if (!name || !/\.js$/.test(name)) return;
        clearTimeout(debounce.get(kind + name));
        debounce.set(
          kind + name,
          setTimeout(() => announce(dir, kind, name), 120),
        );
      });
      watcher.on('error', () => restart());
    } catch (e) {
      console.warn(`No se puede vigilar ${dir}: ${e.message}`);
      restart(2000);
      return;
    }
    // tras rehacer el watcher, lo que cambió mientras tanto se anuncia (el estudio compara por contenido)
    if (rescan) {
      try {
        if (kind === 'tracks') broadcast({ type: 'change', kind, file: `${kind}/`, mtime: Date.now(), source: 'disk' });
        else for (const f of fs.readdirSync(dir).filter((x) => /\.js$/.test(x))) announce(dir, kind, f);
      } catch {
        /* carpeta inaccesible: se reintentará */
      }
    }
  };
  const restart = (ms = 300) => {
    if (restarting) return;
    restarting = setTimeout(() => start(true), ms);
  };
  setInterval(() => {
    const now = identity();
    if (now === null || now !== ino) restart();
  }, 2000).unref();
  start(false);
}
watchDir(LIVE, 'live');
watchDir(TRACKS, 'tracks');
setInterval(() => broadcast({ type: 'ping', t: Date.now() }), 25000).unref();

const listFiles = (dir, files) => files.map((f) => ({ file: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }));

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Demasiado grande'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Escritura de live/: en cola por archivo (dos guardados nunca se solapan) y atómica (archivo temporal + rename),
// así estado.json o sesion.js nunca quedan a medias. En Windows el rename puede fallar si el destino está abierto
// por otro programa (antivirus, OneDrive): entonces se escribe directamente (sigue en la cola, sin solaparse).
const writeQueues = new Map();
function writeOnce(target, text) {
  const tmp = `${path.join(path.dirname(target), `.${path.basename(target)}`)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  return new Promise((resolve, reject) => {
    fs.writeFile(tmp, text, (err) => {
      if (err) return reject(err);
      fs.rename(tmp, target, (err2) => {
        if (!err2) return resolve();
        fs.writeFile(target, text, (err3) => {
          fs.rm(tmp, { force: true }, () => (err3 ? reject(err3) : resolve()));
        });
      });
    });
  });
}
function writeLiveFile(target, text) {
  const job = (writeQueues.get(target) || Promise.resolve()).then(() => writeOnce(target, text));
  const tail = job.catch(() => {});
  writeQueues.set(target, tail);
  tail.then(() => {
    if (writeQueues.get(target) === tail) writeQueues.delete(target);
  });
  return job;
}

const allowedOrigin = (req) => {
  const origin = req.headers.origin;
  return !origin || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
};

async function handleApi(req, res, url) {
  if (url.pathname === '/__events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    let mtime = 0;
    try {
      mtime = fs.statSync(path.join(LIVE, 'sesion.js')).mtimeMs;
    } catch {
      /* aún no hay sesión */
    }
    res.write(`data: ${JSON.stringify({ type: 'hello', sessionMtime: mtime })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return true;
  }
  if (url.pathname === '/__tracks' && req.method === 'GET') {
    json(res, 200, listFiles(TRACKS, trackFiles(TRACKS)));
    return true;
  }
  if (url.pathname === '/__live' && req.method === 'GET') {
    json(res, 200, listFiles(LIVE, fs.readdirSync(LIVE).filter((f) => TRACK_FILE_RE.test(f))));
    return true;
  }
  if ((url.pathname === '/__save' || url.pathname === '/__library') && req.method === 'POST') {
    if (!allowedOrigin(req)) {
      json(res, 403, { error: 'Origen no permitido' });
      return true;
    }
    let text;
    try {
      text = await readBody(req);
    } catch (e) {
      json(res, 413, { error: e.message });
      return true;
    }
    if (url.pathname === '/__save') {
      const name = url.searchParams.get('file') || 'sesion.js';
      if (!/^[\w-]{1,64}\.(js|json)$/.test(name)) {
        json(res, 400, { error: 'Nombre de archivo no válido' });
        return true;
      }
      const rel = `live/${name}`;
      browserSaves.set(rel, text);
      fs.mkdirSync(LIVE, { recursive: true });
      writeLiveFile(path.join(LIVE, name), text).then(
        () => json(res, 200, { ok: true, file: rel, bytes: Buffer.byteLength(text) }),
        (err) => json(res, 500, { error: err.message }),
      );
      return true;
    }
    try {
      const skipped = [];
      const saved = await saveTrack(
        TRACKS,
        {
          id: url.searchParams.get('id'),
          title: url.searchParams.get('title'),
          style: url.searchParams.get('style'),
          // sin descripción: se conserva la del tema que se sobrescribe (o una genérica si es nuevo)
          description: url.searchParams.get('description') || null,
          code: text,
        },
        {
          overwrite: url.searchParams.get('overwrite') === '1',
          force: url.searchParams.get('force') === '1',
          analyze: (code) => analyzeIsolated(code, ANALYZE_MS),
          onSkip: (f, why) => skipped.push(`${f}: ${why}`),
        },
      );
      json(res, 200, { ok: true, id: saved.id, total: saved.total, warnings: saved.warnings, skipped });
    } catch (e) {
      // 409 = sólo avisos: el estudio pregunta si guardar de todos modos (force=1)
      if (e.warnings) json(res, 409, { error: e.message, warnings: e.warnings });
      else json(res, 400, { error: e.message, errors: e.errors || [] });
    }
    return true;
  }
  return false;
}

async function handler(req, res) {
  let url;
  let p;
  try {
    url = new URL(req.url, 'http://localhost');
    p = decodeURIComponent(url.pathname);
    if (p.includes('\0')) throw new Error('byte nulo');
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('400 URL no válida');
  }
  try {
    if (url.pathname.startsWith('/__') && (await handleApi(req, res, url))) return;
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: e.message });
    return;
  }
  if (p.endsWith('/')) p += 'index.html';
  // /live/ y /tracks/ se sirven desde sus carpetas (pueden estar fuera de ROOT); nada sale de su carpeta
  // sin distinguir mayúsculas (en Windows /LIVE/ es la misma carpeta y no debe saltarse PULSO_LIVE)
  const lp = p.toLowerCase();
  const base = lp.startsWith('/live/') ? LIVE : lp.startsWith('/tracks/') ? TRACKS : ROOT;
  const rel = base === LIVE ? p.slice(5) : base === TRACKS ? p.slice(7) : p;
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep) && file !== base) {
    res.writeHead(403);
    return res.end();
  }
  try {
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('404 no encontrado');
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  } catch {
    // ruta que el sistema de archivos no acepta: no tumba el servidor
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 ruta no válida');
  }
}

// Ningún error de una petición tumba el servidor
function safeHandler(req, res) {
  handler(req, res).catch((e) => {
    try {
      if (!res.headersSent) json(res, 500, { error: e.message });
      else res.end();
    } catch {
      /* conexión ya cerrada */
    }
  });
}

// Sólo loopback: IPv4 y (si existe) IPv6. No se abre a la red.
const main = http.createServer(safeHandler);
main.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `El puerto ${PORT} está ocupado (¿Pulso ya está abierto?)` : e.message);
  process.exit(1);
});
main.listen(PORT, HOST, () => {
  console.log(`Pulso en http://localhost:${PORT}`);
  console.log(`  · tests de audio:  http://localhost:${PORT}/test/audio.html`);
  console.log(`  · análisis:        http://localhost:${PORT}/tools/render.html`);
  console.log(`  · Strudel (comparación): http://localhost:${PORT}/strudel/`);
});
if (HOST === '127.0.0.1') {
  const v6 = http.createServer(safeHandler);
  v6.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.warn(`⚠ Otro programa usa [::1]:${PORT}: "localhost" podría abrir ese programa. Abre http://127.0.0.1:${PORT}`);
    }
    // EADDRNOTAVAIL / EAFNOSUPPORT: el equipo no tiene IPv6; no pasa nada
  });
  v6.listen(PORT, '::1');
}
