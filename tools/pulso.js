#!/usr/bin/env node
// Herramienta de línea de comandos de Pulso.
//
//   node tools/pulso.js check [archivo|id ...]     valida temas (todos si no se indica ninguno)
//   node tools/pulso.js info  <archivo|id>          describe secciones, pistas, sonidos y rangos
//   node tools/pulso.js new   <estilo> [semilla] [id]   genera un tema nuevo en tracks/ y lo registra
//   node tools/pulso.js save  <archivo> <id> [estilo] [título]   guarda un código (p. ej. live/sesion.js) en la biblioteca
//        --force: guarda aunque haya avisos · --overwrite: sustituye un tema existente (conserva sus datos)
//   node tools/pulso.js live  <archivo|id>          copia un tema a live/sesion.js (el estudio lo carga)
//   node tools/pulso.js list                         lista temas y estilos del generador
//   node tools/pulso.js index                        regenera tracks/index.js a partir de los archivos
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analyzeSong, formatReport } from '../src/tools/analyze.js';
import { generateTrack, GEN_STYLES } from '../src/gen/generator.js';
import { trackFiles, writeIndex, saveTrack, slugify, libraryStyles, analyzeIsolated } from '../src/tools/indexer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRACKS = path.join(ROOT, 'tracks');
const LIVE = path.join(ROOT, 'live');

async function loadTrack(file) {
  const mod = await import(`${pathToFileURL(file).href}?v=${fs.statSync(file).mtimeMs}`);
  return mod.default;
}

// Acepta: id de tema, ruta a tracks/*.js (módulo con export default) o cualquier archivo de código (live/*.js, .txt)
async function resolveSource(arg) {
  const candidates = [arg, path.join(TRACKS, `${arg}.js`), path.join(LIVE, arg), path.join(LIVE, `${arg}.js`)];
  for (const c of candidates) {
    const p = path.resolve(ROOT, c);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      const text = fs.readFileSync(p, 'utf8');
      if (/export\s+default/.test(text)) {
        const t = await loadTrack(p);
        return { label: t.id || path.basename(p), code: t.code, meta: t, file: p };
      }
      return { label: path.relative(ROOT, p), code: text, file: p };
    }
  }
  throw new Error(`No encuentro "${arg}" (ni como id de tema ni como archivo)`);
}

const warnSkip = (file, why) => console.log(`⚠ tracks/${file} no carga y queda fuera del índice: ${why}`);
// el código de un tema se analiza en un hilo aparte con plazo: un while(true) o un await que nunca acaba
// dan un error claro (y código de salida 1) en vez de colgar la CLI o terminar sin decir nada
const ANALYZE_MS = Number(process.env.PULSO_ANALYZE_MS) || 15000;
const analyze = (code, label) => analyzeIsolated(code, ANALYZE_MS, { label });
async function styleList() {
  try {
    const styles = await libraryStyles(TRACKS);
    return styles ? Object.keys(styles).join(', ') : '(no hay tracks/styles.js)';
  } catch (e) {
    return `(tracks/styles.js no carga: ${e.message})`;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const [cmd = 'help', ...args] = argv.filter((a) => !a.startsWith('--'));
  if (cmd === 'check') {
    const targets = args.length ? args : trackFiles(TRACKS).map((f) => path.join('tracks', f));
    let bad = 0;
    for (const t of targets) {
      try {
        const src = await resolveSource(t);
        const rep = await analyze(src.code, src.label);
        if (!rep.ok) bad++;
        console.log(
          args.length
            ? rep.report
            : `${rep.ok ? '✔' : '✖'} ${src.label}${rep.errors.length ? '\n  ✖ ' + rep.errors.join('\n  ✖ ') : ''}${rep.warnings.length ? '\n  ⚠ ' + rep.warnings.join('\n  ⚠ ') : ''}`,
        );
      } catch (e) {
        bad++;
        console.log(`✖ ${t}: ${e.message}`);
      }
    }
    console.log(`\n${targets.length - bad}/${targets.length} temas válidos`);
    process.exitCode = bad ? 1 : 0;
  } else if (cmd === 'info') {
    if (!args[0]) throw new Error('Uso: info <archivo|id>');
    const src = await resolveSource(args[0]);
    const rep = await analyze(src.code, src.label);
    console.log(rep.report);
    process.exitCode = rep.ok ? 0 : 1;
  } else if (cmd === 'new') {
    const [style, second, third] = args;
    if (!GEN_STYLES[style]) throw new Error(`Uso: new <estilo> [semilla] [id]. Estilos: ${Object.keys(GEN_STYLES).join(', ')}`);
    // el segundo argumento es la semilla si es un número; si no, es el id
    let seed;
    let idArg;
    if (second !== undefined && second.trim() !== '' && Number.isFinite(Number(second))) {
      seed = Number(second);
      idArg = third;
    } else {
      seed = 1 + Math.floor(Math.random() * 99999);
      idArg = second;
    }
    const g = generateTrack({ style, seed });
    const id = slugify(idArg ?? g.title);
    if (!id) throw new Error('El id no tiene letras ni números');
    // lo generado se guarda aunque tenga avisos (el informe de abajo los muestra)
    const saved = await saveTrack(
      TRACKS,
      {
        id,
        title: g.title,
        style,
        description: `${GEN_STYLES[style].label} generado en ${g.key}, ${g.bpm} BPM (semilla ${seed}).`,
        code: g.code,
      },
      { force: true, onSkip: warnSkip },
    );
    const rep = await analyzeSong(g.code);
    console.log(`Creado tracks/${saved.id}.js (${saved.total} temas en la biblioteca)\n${formatReport(rep, saved.id)}`);
  } else if (cmd === 'save') {
    const force = flags.has('--force');
    const overwrite = flags.has('--overwrite');
    const [fileArg, idArg, style, ...titleParts] = args;
    if (!fileArg || !idArg) throw new Error(`Uso: save <archivo> <id> [estilo] [título] [--force] [--overwrite]\nEstilos: ${await styleList()}`);
    const src = await resolveSource(fileArg);
    let saved;
    try {
      saved = await saveTrack(
        TRACKS,
        { id: idArg, title: titleParts.join(' ') || null, style: style || null, code: src.code },
        { force, overwrite, onSkip: warnSkip, analyze: (code) => analyze(code, idArg) },
      );
    } catch (e) {
      if (e.warnings) throw new Error(`${e.message}\n(añade --force para guardarlo igualmente)`);
      if (/Ya existe/.test(e.message)) throw new Error(`${e.message} (añade --overwrite para sustituirlo)`);
      throw e;
    }
    for (const w of saved.warnings) console.log(`⚠ ${w}`);
    console.log(`Guardado tracks/${saved.id}.js (${saved.total} temas en la biblioteca)`);
  } else if (cmd === 'live') {
    if (!args[0]) throw new Error('Uso: live <archivo|id>');
    const src = await resolveSource(args[0]);
    fs.mkdirSync(LIVE, { recursive: true });
    fs.writeFileSync(path.join(LIVE, 'sesion.js'), src.code);
    console.log(`live/sesion.js ← ${src.label}. Si el estudio tiene la sesión enlazada, se recarga solo.`);
  } else if (cmd === 'list') {
    for (const f of trackFiles(TRACKS)) {
      try {
        const t = await loadTrack(path.join(TRACKS, f));
        console.log(`${String(t.id).padEnd(22)} ${String(t.style).padEnd(11)} ${t.title}`);
      } catch (e) {
        console.log(`${f.padEnd(22)} ✖ no carga: ${e.message}`);
      }
    }
    console.log(`\nEstilos del generador: ${Object.keys(GEN_STYLES).join(', ')}`);
  } else if (cmd === 'index') {
    console.log(`tracks/index.js regenerado con ${await writeIndex(TRACKS, { onSkip: warnSkip })} temas`);
  } else {
    // la ayuda es el comentario de la cabecera de este archivo
    const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split(/\r?\n/).slice(1);
    const header = lines.slice(0, Math.max(0, lines.findIndex((l) => !l.startsWith('//'))));
    console.log(header.join('\n').replace(/^\/\/ ?/gm, ''));
    console.log(`\nEstilos de la biblioteca: ${await styleList()}`);
    console.log(`Estilos del generador: ${Object.keys(GEN_STYLES).join(', ')}`);
  }
}

main().catch((e) => {
  console.error(`✖ ${e.message}`);
  process.exitCode = 1;
});
