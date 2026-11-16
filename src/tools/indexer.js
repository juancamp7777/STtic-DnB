// Gestión de la biblioteca en disco (tracks/): índice, nombres y escritura de temas.
// Lo usan la CLI (tools/pulso.js) y el servidor (guardar en biblioteca desde el estudio).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { analyzeSong } from './analyze.js';

// Analiza en un hilo aparte con plazo (ni el servidor ni la CLI se quedan colgados por un while(true) del usuario).
// Devuelve { ok, errors, warnings, report } (report = informe en texto, con label como título).
export function analyzeIsolated(code, ms = 10000, { label = '' } = {}) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./analyze-worker.js', import.meta.url), { workerData: { code: String(code), label: String(label) } });
    const timer = setTimeout(() => {
      w.terminate();
      reject(new Error(`El análisis tardó más de ${Math.round(ms / 100) / 10} s (¿un bucle infinito o un await que no acaba?)`));
    }, ms);
    w.once('message', (r) => {
      clearTimeout(timer);
      w.terminate();
      resolve(r);
    });
    w.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    // el hilo terminó sin responder (p. ej. el código llamó a process.exit()): no se espera al plazo
    w.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`El análisis terminó sin resultado (código ${code}): ¿un await que nunca acaba o process.exit()?`));
    });
  });
}

export const TRACK_FILE_RE = /^[\w-]+\.js$/;
export const RESERVED_FILES = new Set(['index.js', 'styles.js']);

export const trackFiles = (dir) =>
  fs
    .readdirSync(dir)
    .filter((f) => TRACK_FILE_RE.test(f) && !RESERVED_FILES.has(f))
    .sort();

export function slugify(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

// Los finales de línea se guardan siempre como \n: una plantilla de JS convierte \r\n en \n al leerla,
// así que con \r\n el código leído nunca coincidiría con el guardado.
export const normalizeCode = (code) => String(code).replace(/\r\n?/g, '\n');

// Fuente de un archivo de tema. El código va entre backticks: se escapan ` y ${.
export function trackModuleSource({ id, title, style, description, code }) {
  const esc = normalizeCode(code).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  return `export default {\n  id: ${JSON.stringify(id)},\n  title: ${JSON.stringify(title)},\n  style: ${JSON.stringify(style)},\n  description: ${JSON.stringify(description)},\n  code: \`${esc}\`,\n};\n`;
}

// Importa un archivo sin caché vieja: la clave cambia cuando cambia el archivo (tamaño + fecha).
async function importFresh(file) {
  const st = fs.statSync(file);
  return import(`${pathToFileURL(file).href}?v=${st.mtimeMs}-${st.size}`);
}

// Importación siempre nueva (para comprobar justo después de escribir, aunque fecha y tamaño coincidan).
let uniq = 0;
const importUnique = (file) => import(`${pathToFileURL(file).href}?u=${Date.now()}-${++uniq}`);

// Estilos válidos de la biblioteca (tracks/styles.js). null si no hay archivo de estilos.
export async function libraryStyles(dir) {
  const file = path.join(dir, 'styles.js');
  if (!fs.existsSync(file)) return null;
  const mod = await importFresh(file);
  return mod.STYLE_NAMES && typeof mod.STYLE_NAMES === 'object' ? mod.STYLE_NAMES : null;
}

// Las escrituras en la biblioteca van de una en una (dos guardados simultáneos del mismo id no pueden pasar
// los dos la comprobación de "Ya existe", y el índice no se regenera a la vez desde dos sitios).
let libraryLock = Promise.resolve();
function withLibraryLock(fn) {
  const run = libraryLock.then(() => fn());
  libraryLock = run.catch(() => {});
  return run;
}

// Regenera tracks/index.js conservando el orden actual y añadiendo los temas nuevos al final.
// Usa identificadores sintéticos (t0, t1...) para que ningún nombre de archivo rompa el JS.
// Cada tema se comprueba por separado; los que no cargan se dejan fuera (onSkip(archivo, motivo))
// para que un archivo roto no deje vacía toda la biblioteca del estudio. El orden de TODOS los archivos
// (también los que no cargaron) se guarda en la línea "// orden:", así uno roto un momento no se va al final.
export function writeIndex(dir, opts) {
  return withLibraryLock(() => writeIndexNow(dir, opts));
}
async function writeIndexNow(dir, { onSkip = () => {} } = {}) {
  const indexPath = path.join(dir, 'index.js');
  const present = new Set(trackFiles(dir));
  let current = [];
  try {
    const previous = fs.readFileSync(indexPath, 'utf8');
    const header = /^\/\/ orden: (.*)$/m.exec(previous);
    current = (header ? header[1].split(/\s+/) : [...previous.matchAll(/from '\.\/([\w-]+\.js)'/g)].map((m) => m[1])).filter(
      (f) => TRACK_FILE_RE.test(f) && !RESERVED_FILES.has(f),
    );
  } catch {
    /* no hay índice todavía */
  }
  const ordered = [...current.filter((f) => present.has(f)), ...[...present].filter((f) => !current.includes(f))];
  const files = [];
  for (const f of ordered) {
    try {
      const mod = await importFresh(path.join(dir, f));
      if (!mod.default || typeof mod.default !== 'object') throw new Error('no tiene export default');
      if (typeof mod.default.code !== 'string') throw new Error('no tiene code');
      files.push(f);
    } catch (e) {
      onSkip(f, e.message);
    }
  }
  // sin un styles.js que cargue, el índice no puede reexportarlo (no cargaría): se usa una lista vacía
  let hasStyles = false;
  try {
    hasStyles = (await libraryStyles(dir)) !== null;
  } catch (e) {
    onSkip('styles.js', e.message);
  }
  const lines = [
    '// Generado por `node tools/pulso.js index`: lista de todos los temas de la biblioteca.',
    '// Los estilos están en styles.js (ese archivo no se regenera).',
    `// orden: ${ordered.join(' ')}`,
    hasStyles ? "export { STYLE_NAMES } from './styles.js';" : 'export const STYLE_NAMES = {};',
    ...files.map((f, i) => `import t${i} from './${f}';`),
    '',
    `export const TRACKS = [${files.map((_, i) => `t${i}`).join(', ')}];`,
    '',
  ];
  fs.writeFileSync(indexPath, lines.join('\n'));
  return files.length;
}

// Escribe tracks/<id>.js y actualiza el índice.
//   overwrite: permite pisar un tema existente (se conservan su título, estilo y descripción si no se dan otros)
//   force: guarda aunque el analizador dé avisos (con errores nunca se guarda)
// Lanza Error con .warnings (lista) si sólo hay avisos y no se forzó.
export function saveTrack(dir, meta, opts) {
  return withLibraryLock(() => saveTrackNow(dir, meta, opts));
}
async function saveTrackNow(dir, { id, title, style, description, code }, { overwrite = false, force = false, onSkip, analyze = analyzeSong } = {}) {
  const clean = slugify(id || title || '');
  if (!clean) throw new Error('El tema necesita un id o un título con letras o números');
  if (RESERVED_FILES.has(`${clean}.js`)) throw new Error(`"${clean}" es un nombre reservado`);
  const file = path.join(dir, `${clean}.js`);
  const exists = fs.existsSync(file);
  if (exists && !overwrite) throw new Error(`Ya existe tracks/${clean}.js`);
  if (typeof code !== 'string' || !code.trim()) throw new Error('El tema no tiene código');
  const text = normalizeCode(code);
  // los temas de la biblioteca van entre backticks: el código no puede llevar ` ni ${ (convención de tracks/)
  if (text.includes('`') || text.includes('${')) {
    throw new Error('El código de un tema de la biblioteca no puede llevar backticks (`) ni "${": usa comillas dobles');
  }

  // metadatos: al sobrescribir se conservan los que no se indiquen
  let old = null;
  let previous = null;
  if (exists) {
    previous = fs.readFileSync(file, 'utf8');
    try {
      old = (await importUnique(file)).default || null;
    } catch {
      old = null;
    }
  }
  const styles = await libraryStyles(dir);
  const styleNames = styles ? Object.keys(styles) : null;
  const finalStyle = style || old?.style || (styleNames && !styleNames.includes('liquid') ? styleNames[0] : 'liquid');
  if (styleNames && !styleNames.includes(finalStyle)) {
    throw new Error(`Estilo desconocido "${finalStyle}". Estilos válidos: ${styleNames.join(', ')}`);
  }

  // validación musical: con errores nunca; con avisos sólo si se fuerza
  const rep = await analyze(text);
  if (!rep.ok) throw Object.assign(new Error(`El tema tiene errores, no se guarda:\n  ${rep.errors.join('\n  ')}`), { errors: rep.errors });
  if (rep.warnings.length && !force) {
    throw Object.assign(new Error(`El tema tiene avisos (guárdalo forzando si es intencionado):\n  ${rep.warnings.join('\n  ')}`), {
      warnings: rep.warnings,
    });
  }

  const source = trackModuleSource({
    id: clean,
    title: title || old?.title || clean,
    style: finalStyle,
    description: description || old?.description || 'Tema guardado desde Pulso.',
    code: text,
  });
  fs.writeFileSync(file, source);
  try {
    const mod = await importUnique(file);
    if (mod.default.code !== text) throw new Error('el código guardado no coincide');
  } catch (e) {
    // nunca se pierde lo que había: se restaura el archivo anterior (o se quita el nuevo)
    if (previous !== null) fs.writeFileSync(file, previous);
    else fs.rmSync(file, { force: true });
    throw new Error(`No se pudo guardar el tema: ${e.message}`);
  }
  const total = await writeIndexNow(dir, { onSkip }); // ya dentro del candado de la biblioteca
  return { id: clean, file, total, warnings: rep.warnings };
}
