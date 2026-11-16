// Banco de samples externos: compatible con el formato de Strudel
//   samples('github:tidalcycles/dirt-samples')
//   samples({ bd: ['bd/1.wav', 'bd/2.wav'] }, 'https://mi.servidor/samples/')
//   samples({ piano: { a0: 'A0.mp3', c4: 'C4.mp3' } }, base)   (mapas por nota: se elige el más cercano)
// y con archivos locales arrastrados al navegador.
import { noteToMidi } from '../core/theory.js';
import { SAMPLE_BASE_NOTE } from './params.js';

const RETRY_AFTER_MS = 30000;
// tiempo máximo por descarga (cabeceras + cuerpo): una conexión colgada no bloquea la evaluación
export const FETCH_TIMEOUT_MS = 20000;

// fetch con límite de tiempo; read(respuesta) lee el cuerpo dentro del mismo plazo
export async function fetchWithTimeout(url, read, ms = FETCH_TIMEOUT_MS) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (ctrl) ctrl.abort();
      reject(new Error(`Tiempo de espera agotado (${Math.round(ms / 1000)} s) en ${url}`));
    }, ms);
  });
  try {
    const job = (async () => {
      const r = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} en ${url}`), { status: r.status });
      return read(r);
    })();
    job.catch(() => {}); // si gana el plazo, el error del aborto no queda sin capturar
    return await Promise.race([job, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export class SampleBank {
  constructor(ctx) {
    this.ctx = ctx;
    this.entries = new Map(); // nombre -> { urls: [] } | { notes: [{ midi, urls: [] }] }
    this.buffers = new Map(); // url -> AudioBuffer
    this.loading = new Map(); // url -> Promise
    this.failed = new Map(); // url -> { time, error }
    this.onLoad = () => {};
    this.onError = () => {};
  }

  has(name) {
    return this.entries.has(name);
  }

  names() {
    return [...this.entries.keys()];
  }

  // Lista de URLs (y nota original) que corresponde a nombre + variante + nota
  pick(name, n = 0, note = null) {
    const e = this.entries.get(name);
    if (!e) return null;
    if (e.notes) {
      const target = note == null ? SAMPLE_BASE_NOTE : note;
      let best = e.notes[0];
      for (const k of e.notes) if (Math.abs(k.midi - target) < Math.abs(best.midi - target)) best = k;
      if (!best.urls.length) return null;
      return { url: best.urls[n % best.urls.length], baseNote: best.midi };
    }
    if (!e.urls.length) return null;
    return { url: e.urls[n % e.urls.length], baseNote: SAMPLE_BASE_NOTE };
  }

  // { buffer, baseNote } si ya está cargado; si no, inicia la descarga y devuelve null
  resolve(name, n = 0, note = null) {
    const pk = this.pick(name, n, note);
    if (!pk) return null;
    const buf = this.buffers.get(pk.url);
    if (!buf) {
      this.loadUrl(pk.url).catch(() => {});
      return null;
    }
    return { buffer: buf, baseNote: pk.baseNote };
  }

  // compatibilidad: sólo el AudioBuffer
  get(name, n = 0) {
    const r = this.resolve(name, n);
    return r ? r.buffer : null;
  }

  request(name) {
    const e = this.entries.get(name);
    if (!e) return;
    const urls = e.notes ? e.notes.flatMap((k) => k.urls) : e.urls;
    urls.forEach((u) => this.loadUrl(u).catch(() => {}));
  }

  loadUrl(url) {
    if (this.buffers.has(url)) return Promise.resolve(this.buffers.get(url));
    if (this.loading.has(url)) return this.loading.get(url);
    const f = this.failed.get(url);
    if (f && Date.now() - f.time < RETRY_AFTER_MS) return Promise.reject(f.error);
    const p = fetchWithTimeout(url, (r) => r.arrayBuffer())
      .then((ab) => this.ctx.decodeAudioData(ab))
      .then((buf) => {
        this.buffers.set(url, buf);
        this.loading.delete(url);
        this.failed.delete(url);
        this.onLoad(url);
        return buf;
      })
      .catch((e) => {
        this.loading.delete(url);
        const first = !this.failed.has(url);
        this.failed.set(url, { time: Date.now(), error: e });
        if (first) this.onError(url, e);
        throw e;
      });
    this.loading.set(url, p);
    return p;
  }

  // Precarga los samples usados: Map(nombre -> Set(variante | {n, note})).
  // Devuelve los que fallaron: [{ name, url, message }]
  async preload(used) {
    const jobs = new Map();
    for (const [name, list] of used) {
      for (const item of list) {
        const n = typeof item === 'object' ? item.n : item;
        const note = typeof item === 'object' ? item.note : null;
        const pk = this.pick(name, n, note);
        if (pk && !jobs.has(pk.url)) {
          jobs.set(
            pk.url,
            this.loadUrl(pk.url).then(
              () => null,
              (e) => ({ name, url: pk.url, message: e && e.message ? e.message : String(e) }),
            ),
          );
        }
      }
    }
    return (await Promise.all(jobs.values())).filter(Boolean);
  }

  // isCurrent(): ¿sigue vigente la evaluación que pidió este mapa? Si el JSON llega cuando ya hay una evaluación
  // más nueva, no se escribe (si no, el mapa viejo pisaría al de la que suena).
  async load(source, base = '', isCurrent = () => true) {
    let map = source;
    if (typeof source === 'string') {
      let url = source;
      if (url.startsWith('github:')) {
        const path = url.slice(7).replace(/\/$/, '');
        const [user, repo, branch = 'main', ...rest] = path.split('/');
        url = `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${rest.length ? rest.join('/') + '/' : ''}strudel.json`;
      }
      try {
        map = await fetchWithTimeout(url, (r) => r.json());
      } catch (e) {
        throw new Error(`No se pudo leer ${url} (${e.status ? `HTTP ${e.status}` : e.message})`);
      }
      if (!isCurrent()) return 0;
      if (!base) base = url.slice(0, url.lastIndexOf('/') + 1);
    }
    if (!map || typeof map !== 'object') throw new Error('samples(): formato no válido');
    const root = map._base || base || '';
    const abs = (u) => (/^(https?:|blob:|data:)/.test(u) ? u : root + u);
    let count = 0;
    for (const [name, value] of Object.entries(map)) {
      if (name.startsWith('_')) continue;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        // mapa por nota { a0: '...', c4: ['...', '...'] }
        const notes = [];
        for (const [k, v] of Object.entries(value)) {
          let midi;
          try {
            midi = noteToMidi(k);
          } catch {
            continue;
          }
          notes.push({ midi, urls: (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string').map(abs) });
        }
        if (notes.length) {
          notes.sort((a, b) => a.midi - b.midi);
          this.entries.set(name, { notes });
          count++;
        }
        continue;
      }
      const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
      this.entries.set(name, { urls: list.filter((x) => typeof x === 'string').map(abs) });
      count++;
    }
    return count;
  }

  // Archivos locales (input file / drag & drop). La carpeta o el prefijo del nombre es el sonido.
  async addFiles(files) {
    const groups = new Map();
    for (const f of files) {
      if (!/\.(wav|mp3|ogg|flac|aif|aiff|m4a)$/i.test(f.name)) continue;
      const rel = f.webkitRelativePath || f.name;
      const parts = rel.split('/');
      const name = (parts.length > 1 ? parts[parts.length - 2] : f.name.replace(/[\d_\-\s]*\.\w+$/, '')).toLowerCase().replace(/[^\w]/g, '');
      if (!name) continue;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(f);
    }
    const failedFiles = [];
    for (const [name, list] of groups) {
      list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const urls = [];
      for (const f of list) {
        try {
          const buf = await this.ctx.decodeAudioData(await f.arrayBuffer());
          const url = URL.createObjectURL(f);
          this.buffers.set(url, buf);
          urls.push(url);
        } catch (e) {
          failedFiles.push(`${f.name}: ${e.message}`);
        }
      }
      if (urls.length) this.entries.set(name, { urls });
    }
    if (failedFiles.length) this.onError('archivos locales', new Error(failedFiles.join('; ')));
    return [...groups.keys()].filter((n) => this.entries.has(n));
  }
}
