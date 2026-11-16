// Interfaz del estudio Pulso.
import { Engine } from '../audio/engine.js';
import { generateTrack, GEN_STYLES } from '../gen/generator.js';
import { HELP_HTML } from './reference.js';

const $ = (id) => document.getElementById(id);
const codeEl = $('code');
const gutter = $('gutter');
const statusEl = $('status');
const COLORS = ['#39e1b4', '#ff5d8f', '#ffb347', '#6fa8ff', '#c08cff', '#ffe066', '#5ee0ff', '#ff8a5c', '#9dff6f', '#ff6fd8'];

function setStatus(msg, kind = '') {
  statusEl.textContent = msg;
  statusEl.className = `status ${kind}`;
}

// ¿Hay servidor de Pulso (npm start)? Sin él (demo web estática) la sesión y la biblioteca en disco se desactivan.
let hasServer = null;
const serverReady = fetch('__tracks', { cache: 'no-store' })
  .then((r) => r.ok && (r.headers.get('content-type') || '').includes('application/json'))
  .catch(() => false)
  .then((ok) => (hasServer = ok));

// La biblioteca se importa de forma protegida: un tema roto no impide abrir el estudio.
let TRACKS = [];
let STYLE_NAMES = {};
const startupWarnings = [];
try {
  ({ TRACKS, STYLE_NAMES } = await import('../../tracks/index.js'));
} catch (e) {
  startupWarnings.push(`⚠ No se pudo cargar tracks/index.js (${e.message}); se usa la biblioteca de disco o el generador.`);
}

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
      return true;
    } catch {
      return false;
    }
  },
};

const events = [];
const trackColor = new Map();
const uiMuted = new Set();
let lastResult = null;
let lastCode = null; // el código de la última evaluación aplicada (el que suena)
let currentTitle = 'pulso';

const engine = new Engine({
  onTrigger: (ev) => {
    events.push({
      t: ev.time,
      d: Math.max(0.03, ev.params.dur),
      track: ev.track,
      note: ev.params.synth ? ev.params.freq : null,
      s: ev.params.s,
    });
    if (events.length > 3000) events.splice(0, events.length - 3000);
  },
  onError: (e, track) => setStatus(`✖ La pista "${track?.name}" falló en un compás (el resto sigue sonando): ${e.message}`, 'err'),
  onWarning: (msg) => setStatus(`⚠ ${msg}`, 'warn'),
  onState: (s) => {
    $('btnPlay').classList.toggle('on', s === 'playing');
  },
});

// ---------------- editor ----------------
let errorLine = null;
function updateGutter() {
  const lines = codeEl.value.split('\n').length;
  let html = '';
  for (let i = 1; i <= lines; i++) html += i === errorLine ? `<span class="err">${i}</span>\n` : `${i}\n`;
  gutter.innerHTML = html;
  gutter.scrollTop = codeEl.scrollTop;
}
function setCode(code, title) {
  codeEl.value = code;
  if (title) currentTitle = title;
  errorLine = null;
  updateGutter();
  store.set('pulso.code', code);
  // parado, la cabecera enseña el BPM del código cargado (al tocar manda el de la evaluación)
  if (!engine.playing) {
    const m = /\bbpm\(\s*(\d+(?:\.\d+)?)\s*\)/.exec(code.replace(/\/\/.*$/gm, ''));
    $('bpm').textContent = m ? String(Math.round(Number(m[1]))) : '—';
  }
}
codeEl.addEventListener('input', () => {
  errorLine = null;
  updateGutter();
  clearTimeout(setCode.t);
  setCode.t = setTimeout(() => store.set('pulso.code', codeEl.value), 400);
});
codeEl.addEventListener('scroll', () => (gutter.scrollTop = codeEl.scrollTop));

function toggleComment() {
  const v = codeEl.value;
  const s = codeEl.selectionStart;
  const e = codeEl.selectionEnd;
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  let le = v.indexOf('\n', e);
  if (le < 0) le = v.length;
  const lines = v.slice(ls, le).split('\n');
  const all = lines.every((l) => /^\s*\/\//.test(l) || l.trim() === '');
  const out = lines.map((l) => (all ? l.replace(/^(\s*)\/\/ ?/, '$1') : l.trim() === '' ? l : `// ${l}`)).join('\n');
  codeEl.setRangeText(out, ls, le, 'select');
  codeEl.dispatchEvent(new Event('input'));
}

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'Enter') {
    e.preventDefault();
    run();
  } else if (mod && e.key === '.') {
    e.preventDefault();
    stop();
  } else if (mod && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    saveMine();
  } else if (mod && e.key === '/' && document.activeElement === codeEl) {
    e.preventDefault();
    toggleComment();
  } else if (e.key === 'Tab' && document.activeElement === codeEl) {
    e.preventDefault();
    codeEl.setRangeText('  ', codeEl.selectionStart, codeEl.selectionEnd, 'end');
    codeEl.dispatchEvent(new Event('input'));
  }
});

// ---------------- secciones: tocar desde / bucle ----------------
function selectedSection() {
  const name = $('fromSection').value;
  const form = lastResult?.form;
  if (!name || !form) return null;
  const sec = form.sections.find((s) => s.name === name);
  const start = form.startOf(name);
  return sec && start !== null ? { name, start, length: sec.length } : null;
}
const startCycle = () => selectedSection()?.start ?? 0;
function renderSections(form) {
  const sel = $('fromSection');
  const prev = sel.value;
  sel.innerHTML = '<option value="">Desde el inicio</option>';
  if (!form) return;
  const seen = new Set();
  for (const s of form.sections) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    const o = document.createElement('option');
    o.value = s.name;
    o.textContent = `Desde ${s.name} (c${form.startOf(s.name) + 1})`;
    sel.appendChild(o);
  }
  if (seen.has(prev)) sel.value = prev;
}
function applyLoop() {
  const sec = selectedSection();
  if ($('loopOn').checked && sec) engine.setLoop(sec.start, sec.length);
  else if ($('loopOn').checked && lastResult?.form) engine.setLoop(0, lastResult.form.cycles); // exacto: un tema de 40.5 vuelve en 40.5
  else engine.setLoop(null);
}
$('fromSection').onchange = async () => {
  applyLoop();
  if (engine.playing) {
    engine.stop();
    await engine.play(startCycle());
  }
  pushState(); // estado.json: nueva sección y bucle
};
$('loopOn').onchange = () => {
  applyLoop();
  pushState();
};

// ---------------- motor ----------------
let runToken = 0;
async function run() {
  const token = ++runToken;
  const code = codeEl.value;
  try {
    setStatus('Evaluando…');
    const res = await engine.evaluate(code, { from: startCycle() });
    // una evaluación más nueva (o Parar) la dejó obsoleta: no se aplica nada
    if (res.stale || token !== runToken) return;
    lastResult = res;
    lastCode = code;
    const okStatus = { ok: true, bpm: res.bpm, tracks: res.tracks.map((t) => t.name), errors: res.errors, warnings: res.warnings || [] };
    // primero sólo el código; estado.json se escribe una vez, cuando ya está sonando
    pushSession(code, okStatus, false, { state: false });
    for (const name of uiMuted) if (res.tracks.some((t) => t.name === name)) engine.setMuted(name, true);
    renderMixer(res.tracks);
    renderSections(res.form);
    applyLoop();
    $('bpm').textContent = Math.round(res.bpm);
    codeEl.classList.remove('flash');
    void codeEl.offsetWidth;
    codeEl.classList.add('flash');
    errorLine = null;
    updateGutter();
    if (!engine.playing) await engine.play(startCycle());
    if (token !== runToken) return;
    pushSession(code, okStatus); // estado.json con lo que suena ya (sección, bucle, compás)
    const msgs = [
      ...res.errors.map((x) => `⚠ pista "${x.track}": ${x.message}`),
      ...(res.warnings || []).map((w) => `⚠ ${w}`),
      ...res.logs,
    ];
    const summary = `▶ ${res.tracks.length} pistas · ${Math.round(res.bpm)} BPM${res.form ? ` · forma de ${res.form.cycles} compases` : ''}`;
    setStatus(msgs.length ? `${summary}\n${msgs.join('\n')}` : summary, msgs.length ? 'warn' : 'ok');
  } catch (e) {
    if (token !== runToken) return;
    errorLine = e.line ?? null;
    updateGutter();
    setStatus(`✖ ${e.message}`, 'err');
    pushSession(code, { ok: false, error: e.message, line: e.line ?? null });
  }
}
function stop() {
  runToken++;
  engine.stop();
  setStatus('■ Parado');
  pushState(); // estado.json: playing false
}
$('btnPlay').onclick = run;
$('btnStop').onclick = stop;

// ---------------- mezclador ----------------
function renderMixer(tracks) {
  const el = $('mixer');
  el.innerHTML = '';
  for (const t of tracks) {
    if (!trackColor.has(t.name)) trackColor.set(t.name, COLORS[trackColor.size % COLORS.length]);
    const bus = engine.mixer.bus(t.name);
    const row = document.createElement('div');
    row.className = 'strip';
    row.innerHTML = `<span class="dot" style="background:${trackColor.get(t.name)}"></span>
      <span class="name ${t.muted ? 'muted' : ''}"></span>
      <button class="m ${t.muted ? 'on' : ''}" title="Silenciar">M</button>
      <button class="s ${engine.mixer.solo.has(t.name) ? 'on' : ''}" title="Solo">S</button>
      <input type="range" min="0" max="1.5" step="0.01" value="${bus.volume}" title="Volumen" />
      <div class="lvl"><i></i></div>`;
    const nameEl = row.querySelector('.name');
    nameEl.textContent = t.name;
    nameEl.title = t.name;
    const [mBtn, sBtn] = row.querySelectorAll('button');
    mBtn.onclick = () => {
      const on = !mBtn.classList.contains('on');
      mBtn.classList.toggle('on', on);
      nameEl.classList.toggle('muted', on);
      if (on) uiMuted.add(t.name);
      else uiMuted.delete(t.name);
      engine.setMuted(t.name, on);
    };
    sBtn.onclick = () => {
      const on = !sBtn.classList.contains('on');
      sBtn.classList.toggle('on', on);
      engine.setSolo(t.name, on);
    };
    row.querySelector('input').oninput = (e) => engine.setVolume(t.name, Number(e.target.value));
    row.dataset.track = t.name;
    el.appendChild(row);
  }
}

// ---------------- visualización ----------------
const roll = $('roll');
const spec = $('spectrum');
const meter = $('meter');
function fit(c) {
  const r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(10, Math.floor(r.width * dpr));
  const h = Math.max(10, Math.floor(r.height * dpr));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return [w, h];
}
const DRUM_LANES = ['bd', 'kick', 'sn', 'sd', 'snare', 'cp', 'rim', 'hh', 'oh', 'sh', 'tb', 'rd', 'cr', 'tom', 'lt', 'mt', 'ht', 'perc', 'misc', 'cb', 'brk', 'riser', 'down', 'impact', 'zap', 'vinyl'];
function draw() {
  requestAnimationFrame(draw);
  if (!engine.ctx || !engine.mixer) return;
  const now = engine.ctx.currentTime;
  // piano roll
  {
    const [w, h] = fit(roll);
    const g = roll.getContext('2d');
    g.fillStyle = '#07080b';
    g.fillRect(0, 0, w, h);
    const past = 3;
    const future = 0.4;
    const span = past + future;
    const xOf = (t) => ((t - now + past) / span) * w;
    const drumH = h * 0.32;
    const noteTop = 4;
    const noteBot = h - drumH - 6;
    g.strokeStyle = '#1a1d28';
    g.beginPath();
    g.moveTo(0, noteBot + 3);
    g.lineTo(w, noteBot + 3);
    g.stroke();
    let i = 0;
    while (i < events.length && events[i].t + events[i].d < now - past) i++;
    if (i > 0) events.splice(0, i);
    for (const e of events) {
      const x = xOf(e.t);
      if (x > w) continue;
      const ww = Math.max(2, (e.d / span) * w);
      g.fillStyle = trackColor.get(e.track) || '#888';
      g.globalAlpha = e.t <= now && now <= e.t + e.d ? 1 : 0.55;
      if (e.note) {
        const midi = 69 + 12 * Math.log2(e.note / 440);
        const y = noteBot - ((Math.min(100, Math.max(20, midi)) - 20) / 80) * (noteBot - noteTop);
        g.fillRect(x, y - 2, ww, 4);
      } else {
        let lane = DRUM_LANES.indexOf(e.s);
        if (lane < 0) lane = DRUM_LANES.length - 1;
        const y = h - 4 - (lane / DRUM_LANES.length) * drumH;
        g.fillRect(x, y - 2, Math.max(3, Math.min(ww, 10)), 4);
      }
    }
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff55';
    g.fillRect(xOf(now), 0, 1, h);
  }
  // espectro
  {
    const [w, h] = fit(spec);
    const g = spec.getContext('2d');
    const an = engine.mixer.analyser;
    const data = new Uint8Array(an.frequencyBinCount);
    an.getByteFrequencyData(data);
    g.fillStyle = '#07080b';
    g.fillRect(0, 0, w, h);
    const bars = 64;
    const nyq = engine.ctx.sampleRate / 2;
    for (let b = 0; b < bars; b++) {
      const f0 = 20 * (nyq / 20) ** (b / bars);
      const f1 = 20 * (nyq / 20) ** ((b + 1) / bars);
      const i0 = Math.floor((f0 / nyq) * data.length);
      const i1 = Math.max(i0 + 1, Math.floor((f1 / nyq) * data.length));
      let m = 0;
      for (let k = i0; k < i1 && k < data.length; k++) m = Math.max(m, data[k]);
      const bh = (m / 255) * h;
      g.fillStyle = `hsl(${165 - b * 2}, 75%, 55%)`;
      g.fillRect((b / bars) * w + 1, h - bh, w / bars - 2, bh);
    }
  }
  // medidores
  {
    const g = meter.getContext('2d');
    const lvl = Math.min(1, engine.mixer.masterLevel() * 2.2);
    g.fillStyle = '#000';
    g.fillRect(0, 0, meter.width, meter.height);
    g.fillStyle = lvl > 0.9 ? '#ff5c5c' : lvl > 0.7 ? '#ffb347' : '#39e1b4';
    g.fillRect(0, 6, lvl * meter.width, meter.height - 12);
    for (const row of $('mixer').children) {
      const l = Math.min(1, engine.mixer.level(row.dataset.track) * 3);
      row.querySelector('.lvl i').style.width = `${(l * 100).toFixed(0)}%`;
    }
  }
  // lectura (con bucle, el ciclo real es el de la sección que se repite)
  if (engine.playing) {
    let c = engine.cycle();
    if (engine.loop) {
      const { start, length } = engine.loop;
      c = start + ((((c - start) % length) + length) % length);
    }
    $('bar').textContent = Math.max(0, Math.floor(c)) + 1;
    const sec = lastResult?.form?.at(Math.max(0, c));
    $('section').textContent = sec ? `${sec.name} ${sec.bar + 1}/${Math.ceil(sec.length)}` : '—';
  }
  $('voices').textContent = engine.voices;
}
requestAnimationFrame(draw);

// ---------------- biblioteca ----------------
// Con el servidor de Pulso, los temas se descubren en tracks/ y se recargan solos al cambiar.
let library = TRACKS;
async function loadLibrary() {
  if (!(await serverReady)) {
    // demo web: la biblioteca es la de tracks/index.js
    library = TRACKS;
    renderLibrary();
    return;
  }
  try {
    const r = await fetch('__tracks', { cache: 'no-store' });
    if (!r.ok) throw new Error('sin servidor');
    const list = await r.json();
    const broken = [];
    const mods = await Promise.all(
      list.map((x) =>
        import(`../../tracks/${x.file}?v=${Math.round(x.mtime)}`)
          .then((m) => m.default)
          .catch((e) => {
            broken.push(`tracks/${x.file}: ${e.message}`);
            return null;
          }),
      ),
    );
    if (broken.length) setStatus(`⚠ Temas que no cargan:\n${broken.join('\n')}`, 'warn');
    const found = mods.filter((t) => t && t.code && t.title);
    const order = TRACKS.map((t) => t.id);
    found.sort((a, b) => {
      const ia = order.indexOf(a.id);
      const ib = order.indexOf(b.id);
      return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib) || a.title.localeCompare(b.title);
    });
    if (found.length) library = found;
  } catch {
    library = TRACKS;
  }
  renderLibrary();
}
function renderLibrary() {
  const el = $('tab-lib');
  el.innerHTML = '';
  if (!library.length) el.innerHTML = '<p class="hint">No hay temas en la biblioteca. Usa el generador o guarda uno desde "Mis temas".</p>';
  const byStyle = new Map();
  for (const t of library) {
    if (!byStyle.has(t.style)) byStyle.set(t.style, []);
    byStyle.get(t.style).push(t);
  }
  for (const [style, list] of byStyle) {
    const h = document.createElement('div');
    h.className = 'group-title';
    h.textContent = STYLE_NAMES[style] || style;
    el.appendChild(h);
    for (const t of list) {
      const c = document.createElement('div');
      c.className = 'card';
      c.dataset.id = t.id;
      // la tarjeta del tema cargado sigue marcada aunque la biblioteca se vuelva a pintar
      if (currentMeta && currentMeta.id === t.id) c.classList.add('active');
      c.innerHTML = '<h4></h4><p></p>';
      c.querySelector('h4').textContent = t.title;
      c.querySelector('p').textContent = t.description || '';
      c.onclick = () => loadTrack(t.code, t.title, c, { id: t.id, style: t.style, description: t.description });
      el.appendChild(c);
    }
  }
}
// Datos del tema cargado (para guardarlo en la biblioteca con su estilo y descripción)
let currentMeta = null;
function loadTrack(code, title, card, meta = null) {
  document.querySelectorAll('.card.active').forEach((x) => x.classList.remove('active'));
  if (card) card.classList.add('active');
  setCode(code, title);
  currentMeta = meta ? { ...meta, title } : null;
  if (meta?.style && [...$('libStyle').options].some((o) => o.value === meta.style)) $('libStyle').value = meta.style;
  // el nombre propuesto es siempre el de lo que se acaba de cargar (tema, generado, Mis temas o archivo):
  // nunca se hereda el del tema anterior
  $('saveName').value = title;
  if (engine.playing) run();
  else setStatus(`"${title}" cargado. Ctrl+Enter para tocar.`, 'ok');
}

// ---------------- generador ----------------
for (const [k, s] of Object.entries(GEN_STYLES)) {
  const o = document.createElement('option');
  o.value = k;
  o.textContent = s.label;
  $('genStyle').appendChild(o);
}
const randSeed = () => 1 + Math.floor(Math.random() * 99999);
$('genDice').onclick = () => ($('genSeed').value = randSeed());
const genMeta = (g, seed) => ({
  style: g.style,
  description: `${GEN_STYLES[g.style].label} generado en ${g.key}, ${g.bpm} BPM (semilla ${seed}).`,
});
$('genGo').onclick = () => {
  const seed = Number($('genSeed').value) || 1;
  const g = generateTrack({ style: $('genStyle').value, seed });
  loadTrack(g.code, g.title, null, genMeta(g, seed));
};
$('genBatch').onclick = () => {
  const el = $('genList');
  el.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const seed = randSeed();
    const g = generateTrack({ style: $('genStyle').value, seed });
    const c = document.createElement('div');
    c.className = 'card';
    c.innerHTML = `<span class="tag">${GEN_STYLES[g.style].label}</span><h4></h4><p>${g.key} · ${g.bpm} BPM · semilla ${seed}</p>`;
    c.querySelector('h4').textContent = g.title;
    c.onclick = () => {
      $('genSeed').value = seed;
      loadTrack(g.code, g.title, c, genMeta(g, seed));
    };
    el.appendChild(c);
  }
};

// ---------------- mis temas / biblioteca en disco ----------------
function mine() {
  return store.get('pulso.mine', []);
}
function renderMine() {
  const el = $('mineList');
  el.innerHTML = '';
  const list = mine();
  if (list.length === 0) el.innerHTML = '<p class="hint">Aún no guardaste temas. Ctrl+S guarda el código actual.</p>';
  list.forEach((m, i) => {
    const c = document.createElement('div');
    c.className = 'card';
    c.innerHTML = `<h4></h4><p>${new Date(m.date).toLocaleString()}</p><div class="actions"><button data-a="load">Abrir</button><button data-a="del">Borrar</button></div>`;
    c.querySelector('h4').textContent = m.name;
    c.querySelector('[data-a=load]').onclick = (e) => {
      e.stopPropagation();
      loadTrack(m.code, m.name, c);
    };
    c.querySelector('[data-a=del]').onclick = (e) => {
      e.stopPropagation();
      if (!confirm(`¿Borrar "${m.name}"?`)) return;
      const l = mine();
      l.splice(i, 1);
      store.set('pulso.mine', l);
      renderMine();
    };
    el.appendChild(c);
  });
}
function titleFromCode(code) {
  const m = /^\/\/\s*([^\n—-]+)/.exec(code.trim());
  return m ? m[1].trim() : currentTitle;
}
function saveMine(name = null, code = codeEl.value) {
  name = name || $('saveName').value.trim() || titleFromCode(code) || 'Sin título';
  const list = mine();
  const i = list.findIndex((m) => m.name === name);
  const entry = { name, code, date: Date.now() };
  if (i >= 0) list[i] = entry;
  else list.unshift(entry);
  if (!store.set('pulso.mine', list)) {
    setStatus('✖ No se pudo guardar en el navegador (almacenamiento lleno o bloqueado). Usa "Exportar .js" o "Guardar en biblioteca".', 'err');
    return false;
  }
  renderMine();
  setStatus(`💾 Guardado como "${name}"`, 'ok');
  return true;
}
$('btnSave').onclick = () => saveMine();
for (const [k, label] of Object.entries(STYLE_NAMES)) {
  const o = document.createElement('option');
  o.value = k;
  o.textContent = label;
  $('libStyle').appendChild(o);
}
async function saveToLibrary(overwrite = false, force = false) {
  const title = $('saveName').value.trim() || titleFromCode(codeEl.value) || 'Tema nuevo';
  // mismo tema que el cargado: se guarda en SU archivo (aunque su id no sea el título) y conserva su descripción
  const same = !!currentMeta && currentMeta.title === title;
  const id = same && currentMeta.id ? currentMeta.id : title;
  const params = new URLSearchParams({ id, title, style: $('libStyle').value || 'liquid' });
  if (same && currentMeta.description) params.set('description', currentMeta.description);
  if (overwrite) params.set('overwrite', '1');
  if (force) params.set('force', '1');
  let r;
  try {
    r = await fetch(`__library?${params}`, { method: 'POST', body: codeEl.value });
  } catch (e) {
    return setStatus(`✖ No se pudo guardar en la biblioteca: ${e.message}. ¿Está corriendo "npm start"?`, 'err');
  }
  const j = await r.json().catch(() => ({}));
  if (r.ok) {
    const warn = (j.warnings || []).map((w) => `⚠ ${w}`);
    const skipped = (j.skipped || []).map((s) => `⚠ fuera del índice: ${s}`);
    const msg = [`📚 Guardado en la biblioteca como tracks/${j.id}.js (${j.total} temas)`, ...warn, ...skipped];
    setStatus(msg.join('\n'), warn.length || skipped.length ? 'warn' : 'ok');
    // la descripción ya está guardada en el archivo: los siguientes guardados no la envían (el servidor la conserva)
    currentMeta = { id: j.id, title, style: $('libStyle').value, description: null };
    await loadLibrary();
    return;
  }
  if (/Ya existe/.test(j.error || '') && !overwrite) {
    if (confirm(`${j.error}. ¿Reemplazarlo?`)) return saveToLibrary(true, force);
    return setStatus('No se guardó (ya existe un tema con ese nombre).', 'warn');
  }
  if (r.status === 409 && j.warnings) {
    const list = j.warnings.map((w) => `• ${w}`).join('\n');
    if (confirm(`El tema tiene avisos:\n${list}\n\n¿Guardarlo igualmente?`)) return saveToLibrary(overwrite, true);
    return setStatus(`No se guardó. Avisos:\n${list}`, 'warn');
  }
  setStatus(`✖ No se pudo guardar en la biblioteca: ${j.error || `HTTP ${r.status}`}`, 'err');
}
$('btnLibrary').onclick = () => saveToLibrary();
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const safeName = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'pulso';
$('btnExport').onclick = () => download(`${safeName(titleFromCode(codeEl.value))}.js`, new Blob([codeEl.value], { type: 'text/javascript' }));
$('fileImport').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const text = await f.text();
  const m = /code:\s*`([\s\S]*)`/.exec(text);
  loadTrack(m ? m[1].replace(/\\`/g, '`').replace(/\\\$\{/g, '${').replace(/\\\\/g, '\\') : text, f.name.replace(/\.\w+$/, ''));
  e.target.value = '';
};

// ---------------- samples ----------------
function renderSamples() {
  const names = engine.bank ? engine.bank.names() : [];
  $('smpList').textContent = names.length ? `Cargados (${names.length}): ${names.join(', ')}` : 'Sin samples externos todavía.';
}
$('smpDir').onchange = async (e) => {
  await engine.init();
  setStatus('Cargando samples…');
  try {
    const names = await engine.bank.addFiles([...e.target.files]);
    setStatus(names.length ? `Samples cargados: ${names.join(', ')} → úsalos con s("nombre:0")` : 'No se encontraron audios en esa carpeta', names.length ? 'ok' : 'warn');
  } catch (err) {
    setStatus(`✖ ${err.message}`, 'err');
  }
  renderSamples();
};
$('smpLoad').onclick = async () => {
  await engine.init();
  setStatus('Descargando mapa de samples…');
  try {
    const n = await engine.bank.load($('smpRepo').value.trim());
    setStatus(`${n} sonidos registrados (se descargan al usarlos).`, 'ok');
  } catch (err) {
    setStatus(`✖ ${err.message}`, 'err');
  }
  renderSamples();
};

// ---------------- render WAV / stems / compartir ----------------
function renderOptions() {
  const v = $('renderLen').value;
  const sec = selectedSection();
  return {
    cycles: v === 'song' ? (sec && $('loopOn').checked ? sec.length : 'song') : Number(v),
    from: sec ? sec.start : 0,
  };
}
// El WAV es lo que se oye en el mezclador: mute, solo y volúmenes incluidos.
// Las pistas en M no existen en el export (tampoco su sidechain), igual que al tocar en directo.
// Se exporta el código del EDITOR: si no es el que suena, manda su "_" (más el botón M), y sólo cuentan los
// solos de pistas que existen en ese código (un solo de una pista que ya no está dejaría el WAV mudo).
function mixOptions(code = codeEl.value) {
  if (!engine.mixer) return {};
  const evaluated = code === lastCode;
  return {
    audible: (name, names) => {
      if (engine.mixer.buses.get(name)?.muted) return false;
      const solo = [...engine.mixer.solo].filter((s) => !names || names.includes(s));
      return solo.length === 0 || solo.includes(name);
    },
    muted: (name, codeMuted) => (evaluated ? engine.isMuted(name, codeMuted) : codeMuted || !!engine.mixer.buses.get(name)?.muted),
    volumes: Object.fromEntries([...engine.mixer.buses].map(([n, b]) => [n, b.volume])),
  };
}
$('btnRender').onclick = async () => {
  setStatus('Renderizando… (offline, más rápido que tiempo real)');
  const t0 = performance.now();
  try {
    await engine.init();
    const { stats, wav, warnings } = await engine.render(codeEl.value, { ...renderOptions(), ...mixOptions() });
    const name = `${safeName(titleFromCode(codeEl.value))}.wav`;
    download(name, new Blob([wav()], { type: 'audio/wav' }));
    const line = `⤓ ${name}: ${stats.cycles} compases desde c${stats.from + 1} · ${stats.seconds.toFixed(1)} s · pico ${stats.peakDb.toFixed(1)} dBFS · RMS ${stats.rmsDb.toFixed(1)} dBFS · ${stats.events} eventos · render en ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    const warnText = warnings.map((w) => `⚠ ${w}`).join('\n');
    setStatus(warnings.length ? `${line}\n${warnText}` : line, warnings.length ? 'warn' : 'ok');
  } catch (e) {
    setStatus(`✖ ${e.message}`, 'err');
  }
};
$('btnStems').onclick = async () => {
  setStatus('Renderizando stems (un WAV por pista)…');
  try {
    await engine.init();
    const { muted, volumes } = mixOptions();
    const stems = await engine.renderStems(codeEl.value, { ...renderOptions(), muted, volumes });
    const base = safeName(titleFromCode(codeEl.value));
    for (const s of stems) download(`${base}-${safeName(s.name)}.wav`, new Blob([s.wav()], { type: 'audio/wav' }));
    // avisos de cada stem (samples que no cargaron, picos por encima de 0 dBFS), sin repetir
    const warns = [...new Set(stems.flatMap((s) => s.warnings || []))];
    const line = `⤓ ${stems.length} stems (WAV de 32 bits en coma flotante, sin master): ${stems.map((s) => s.name).join(', ')}`;
    setStatus(warns.length ? `${line}\n${warns.map((w) => `⚠ ${w}`).join('\n')}` : line, warns.length ? 'warn' : 'ok');
  } catch (e) {
    setStatus(`✖ ${e.message}`, 'err');
  }
};
function encodeCode(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeCode(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
$('btnShare').onclick = async () => {
  // sólo se copia: la barra de direcciones no cambia (recargar no pisa tu trabajo)
  const url = `${location.origin}${location.pathname}#code=${encodeCode(codeEl.value)}`;
  try {
    await navigator.clipboard.writeText(url);
    setStatus('🔗 Enlace copiado al portapapeles', 'ok');
  } catch {
    setStatus(`🔗 Copia este enlace:\n${url}`, 'ok');
  }
};

// ---------------- sesión compartida (colaboración con Claude) ----------------
// El estudio guarda en live/sesion.js lo que tocas y recarga ese archivo cuando cambia en disco.
// Nunca pisa tu código sin preguntar: si el editor tiene cambios que no se han tocado, aparece un aviso.
const ses = {
  on: store.get('pulso.ses', false),
  file: 'sesion.js',
  synced: store.get('pulso.ses.synced', null), // último texto en común con el disco
  disk: null, // último contenido conocido de live/sesion.js (null = desconocido)
  dismissed: null, // versión de disco que el usuario decidió no cargar (sólo mientras el disco la conserve)
  es: null,
  pending: null,
  lastStatus: null, // último estado de evaluación (para reescribir estado.json al parar o cambiar de sección)
  unsent: null, // { code, status } que no llegó al disco (se reenvía al reconectar)
  q: Promise.resolve(), // cola: las escrituras de esta pestaña nunca se solapan
};
const markSynced = (text) => {
  ses.synced = text;
  store.set('pulso.ses.synced', text);
};
const sesLog = (msg) => {
  const d = document.createElement('div');
  d.textContent = `${new Date().toLocaleTimeString()} · ${msg}`;
  $('sesLog').prepend(d);
  while ($('sesLog').children.length > 30) $('sesLog').lastChild.remove();
};
function sesState(text, kind) {
  $('sesState').textContent = text;
  $('sesState').className = `hint ${kind || ''}`;
}
// Lo que Claude necesita saber de lo que suena: sección elegida, bucle y compás actual
// (con bucle, el mismo compás que muestra el estudio, no el ciclo crudo del reloj).
function playState() {
  const sec = selectedSection();
  let c = engine.playing ? engine.cycle() : null;
  if (c !== null && engine.loop) {
    const { start, length } = engine.loop;
    c = start + ((((c - start) % length) + length) % length);
  }
  return {
    playing: engine.playing,
    from: sec ? sec.name : null,
    loop: engine.loop ? { start: engine.loop.start, length: engine.loop.length, section: sec && $('loopOn').checked ? sec.name : null } : null,
    cycle: c === null ? null : Math.floor(c),
    section: c === null ? null : (lastResult?.form?.at(Math.max(0, c))?.name ?? null),
  };
}
// Las escrituras de sesión de esta pestaña van en cola: dos POST de estado.json nunca se solapan
// (el servidor escribe el archivo entero y uno corto encima de uno largo podía dejarlo roto)
function queueSession(job) {
  const run = ses.q.then(job);
  ses.q = run.catch(() => {});
  return run;
}
async function writeState() {
  const r = await fetch('__save?file=estado.json', {
    method: 'POST',
    body: JSON.stringify({ time: new Date().toISOString(), ...playState(), ...(ses.lastStatus || {}) }, null, 2),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} en estado.json`);
}
// Escribe live/sesion.js (si el disco tiene otra cosa) y estado.json. Devuelve true si todo llegó al disco.
//   state: false -> sólo el código (run() escribe el estado una vez, cuando ya está sonando)
function pushSession(code, status, force = false, { state = true } = {}) {
  if (!ses.on && !force) return Promise.resolve(false);
  if (status) ses.lastStatus = status;
  return queueSession(async () => {
    try {
      // se compara con lo que hay en DISCO (no con lo último en común): si el disco tiene otra versión
      // (p. ej. de Claude que decidiste no cargar), tu código se escribe igualmente
      if (code !== ses.disk || force) {
        const r = await fetch(`__save?file=${ses.file}`, { method: 'POST', body: code });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        ses.disk = code;
        ses.dismissed = null; // el disco ya no tiene la versión descartada
        markSynced(code);
      }
      ses.unsent = null;
      if (state) await writeState();
      return true;
    } catch (e) {
      ses.unsent = { code, status: status || ses.lastStatus };
      sesState(`No se pudo guardar la sesión: ${e.message} (se reintentará al reconectar)`, 'off');
      return false;
    }
  });
}
// Sólo estado.json (al parar, al cambiar "Desde…" o el bucle): lo que suena ahora
function pushState() {
  if (!ses.on) return Promise.resolve(false);
  return queueSession(() =>
    writeState().then(
      () => true,
      (e) => {
        sesState(`No se pudo guardar el estado: ${e.message}`, 'off');
        return false;
      },
    ),
  );
}
function applySession(text, why) {
  setCode(text, 'sesión');
  markSynced(text);
  $('banner').hidden = true;
  ses.pending = null;
  // es código de la sesión, no el tema que se cargó antes: no hereda su nombre ni sus datos al guardarlo
  $('saveName').value = '';
  currentMeta = null;
  // el disco cambió después del aviso (p. ej. tocaste tu versión mientras estaba abierto):
  // lo que ves pasa a ser también lo que hay en disco (sólo con la sesión enlazada)
  if (ses.on && ses.disk !== null && ses.disk !== text) pushSession(text, { ok: null, note: 'versión cargada desde el aviso' }, true);
  sesLog(why);
  if (engine.playing) run();
  else setStatus(`🤝 ${why}. Ctrl+Enter para tocar.`, 'ok');
}
// Devuelve false si no hay archivo de sesión en disco.
async function pullSession(reason) {
  const r = await fetch(`live/${ses.file}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) return false;
  const text = await r.text();
  ses.disk = text;
  if (text !== ses.dismissed) ses.dismissed = null; // el descarte sólo vale mientras el disco conserve esa versión
  if (text === codeEl.value) {
    markSynced(text);
    return true;
  }
  if (text === ses.synced || text === ses.dismissed) return true; // eco propio o versión ya descartada
  const dirty = ses.synced === null || codeEl.value !== ses.synced;
  if (dirty) {
    ses.pending = text;
    $('bannerText').textContent = `${reason}, pero tienes cambios que no están en la sesión.`;
    $('banner').hidden = false;
    sesLog(`${reason} (esperando tu decisión)`);
  } else applySession(text, reason);
  return true;
}
function connectSession() {
  if (ses.es) ses.es.close();
  ses.es = null;
  if (!ses.on) {
    // desenlazada: el aviso de cambios de Claude ya no aplica (y "Cargar" no debe escribir en disco)
    $('banner').hidden = true;
    ses.pending = null;
    sesState('Desconectado.');
    return;
  }
  if (typeof EventSource === 'undefined') {
    sesState('Este navegador no soporta la sesión en vivo.', 'off');
    return;
  }
  const es = new EventSource('__events');
  ses.es = es;
  // al conectar (y al reconectar) se mira si la sesión cambió mientras tanto
  es.onopen = async () => {
    sesState(`Enlazado con live/${ses.file}`, 'on');
    try {
      const had = await pullSession('La sesión cambió mientras estabas desconectado');
      if (!had) {
        if (await pushSession(codeEl.value, { ok: null, note: 'sesión creada desde el estudio' }, true)) sesLog('Sesión creada con tu código');
      } else if (ses.unsent && ses.disk === ses.synced) {
        // lo último que tocaste no llegó al disco y Claude no lo cambió mientras tanto: se reenvía
        if (await pushSession(ses.unsent.code, ses.unsent.status)) sesLog('Se reenvió a live/sesion.js lo que tocaste sin conexión');
      }
    } catch {
      /* se reintentará al reconectar */
    }
  };
  es.onerror = () => sesState('Sin conexión con el servidor de Pulso (reintentando…). ¿Está corriendo "npm start"?', 'off');
  es.onmessage = async (m) => {
    let ev;
    try {
      ev = JSON.parse(m.data);
    } catch {
      return;
    }
    if (ev.type !== 'change') return;
    if (ev.kind === 'live' && ev.file === `live/${ses.file}`) await pullSession('Claude actualizó la sesión').catch(() => {});
    if (ev.kind === 'tracks') {
      await loadLibrary();
      sesLog(`Biblioteca actualizada (${ev.file})`);
    }
  };
}
$('sesOn').checked = ses.on;
$('sesOn').onchange = () => {
  if (hasServer === false) return;
  ses.on = $('sesOn').checked;
  store.set('pulso.ses', ses.on);
  connectSession();
};
$('sesPull').onclick = async () => {
  const r = await fetch(`live/${ses.file}?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return setStatus('No hay live/sesion.js todavía', 'warn');
  const text = await r.text();
  ses.disk = text;
  applySession(text, 'Sesión cargada');
};
$('sesPush').onclick = async () => {
  if (await pushSession(codeEl.value, { ok: null, note: 'enviado a mano' }, true)) sesLog('Tu código se envió a live/sesion.js');
  else sesLog('No se pudo enviar tu código (¿está corriendo "npm start"?)');
};
$('bannerLoad').onclick = () => ses.pending !== null && applySession(ses.pending, 'Cambios de Claude cargados');
$('bannerKeep').onclick = () => {
  $('banner').hidden = true;
  ses.dismissed = ses.pending;
  ses.pending = null;
  sesLog('Mantuviste tu versión (se enviará al tocar)');
};

// ---------------- demo web (sin servidor) ----------------
// En una web estática (p. ej. GitHub Pages) no hay servidor de Pulso: la sesión compartida con Claude y
// "Guardar en biblioteca" necesitan el servidor local (npm start). Tocar, generar, exportar, samples, MIDI y
// la ayuda funcionan igual.
const REPO_URL = 'https://github.com/juancamp7777/STtic-DnB';
function enterDemoMode() {
  ses.on = false; // no se guarda: al volver al estudio local la sesión sigue como estaba
  $('sesOn').checked = false;
  $('banner').hidden = true;
  for (const id of ['sesOn', 'sesPull', 'sesPush', 'btnLibrary']) {
    $(id).disabled = true;
    $(id).title = 'Necesita el servidor local de Pulso (npm start)';
  }
  sesState('Demo web: la sesión compartida con Claude necesita el servidor local.', 'off');
  const note = () => {
    const p = document.createElement('p');
    p.className = 'hint demo-note';
    p.innerHTML = `Para componer en vivo con Claude y guardar temas en la biblioteca, descarga Pulso desde <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a>, ejecuta <code>npm start</code> (sólo hace falta Node) y abre <a href="https://claude.com/claude-code" target="_blank" rel="noopener">Claude Code</a> en esa carpeta.`;
    return p;
  };
  $('tab-ses').appendChild(note());
  $('tab-mine').appendChild(note());
}
serverReady.then((ok) => (ok ? connectSession() : enterDemoMode()));

// ---------------- pestañas / arranque ----------------
$('tabs').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('on', p.id === `tab-${b.dataset.tab}`));
  if (b.dataset.tab === 'smp') renderSamples();
};
$('tab-help').innerHTML = HELP_HTML;
renderLibrary();
loadLibrary();
renderMine();

// Enlaces: al abrir el estudio o al cambiar la dirección con el estudio ya abierto. Se cargan y se quitan de la
// barra de direcciones (history.replaceState no vuelve a disparar hashchange).
//   #code=...      código compartido con 🔗
//   #tema=<id>     un tema de la biblioteca (p. ej. #tema=fibonacci): listo para pulsar ▶ Tocar
// Si lo que había en el editor es trabajo tuyo (no es un tema de la biblioteca ni está ya en "Mis temas"),
// se guarda una copia en "Mis temas" para no perderlo.
function readHashLink() {
  const h = location.hash;
  if (!h.startsWith('#code=') && !h.startsWith('#tema=')) return null;
  history.replaceState(null, '', location.pathname + location.search);
  if (h.startsWith('#code=')) {
    try {
      return { code: decodeCode(h.slice(6)) };
    } catch {
      return { warning: '⚠ El enlace compartido está dañado: no se pudo leer el código.' };
    }
  }
  let id = h.slice(6);
  try {
    id = decodeURIComponent(id);
  } catch {
    /* un % suelto: se busca tal cual */
  }
  const track = library.find((t) => t.id === id) || TRACKS.find((t) => t.id === id);
  return track ? { code: track.code, track } : { warning: `⚠ No hay ningún tema "${id}" en la biblioteca.` };
}
function isKnownCode(code) {
  return TRACKS.some((t) => t.code === code) || library.some((t) => t.code === code) || mine().some((m) => m.code === code);
}
// guarda en "Mis temas" el código que se va a sustituir si es trabajo propio; true si hizo copia
function backupBeforeLink(previous, next) {
  if (!previous || !previous.trim() || previous === next || isKnownCode(previous)) return false;
  return saveMine(`Copia antes de abrir un enlace (${new Date().toLocaleString()})`, previous);
}
function libraryCard(id) {
  return [...document.querySelectorAll('#tab-lib .card')].find((c) => c.dataset.id === id) || null;
}
function openLink(link, previous) {
  const copied = backupBeforeLink(previous, link.code);
  const note = copied ? '\n💾 Lo que tenías en el editor quedó guardado en «Mis temas».' : '';
  if (link.track) {
    const t = link.track;
    loadTrack(t.code, t.title, libraryCard(t.id), { id: t.id, style: t.style, description: t.description });
    if (!engine.playing) setStatus(`"${t.title}" listo: pulsa ▶ Tocar (o Ctrl+Enter).${note}`, 'ok');
  } else {
    const m = /^\/\/\s*([^\n—-]+)/.exec(link.code.trim());
    loadTrack(link.code, m ? m[1].trim() : 'compartido', null);
    if (!engine.playing) setStatus(`Código compartido cargado: pulsa ▶ Tocar (o Ctrl+Enter).${note}`, 'ok');
  }
}
const startLink = readHashLink();
const saved = store.get('pulso.code', null);
const fallback = TRACKS[0] || generateTrack({ style: 'liquid', seed: 1 });
if (startLink?.code != null) openLink(startLink, saved);
else {
  if (startLink?.warning) startupWarnings.push(startLink.warning);
  // el título es el de lo que hay en el editor (tu código guardado), no el del primer tema de la biblioteca
  setCode(saved ?? fallback.code, saved ? titleFromCode(saved) : fallback.title);
}
if (startupWarnings.length) setStatus(startupWarnings.join('\n'), 'warn');
window.addEventListener('hashchange', () => {
  const link = readHashLink();
  if (!link) return;
  if (link.code != null) openLink(link, codeEl.value);
  else setStatus(link.warning, 'warn');
});

// expuesto para depurar desde la consola
window.pulso = { engine, run, stop, setCode, TRACKS, generateTrack, ses };
