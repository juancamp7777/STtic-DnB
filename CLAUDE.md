# Pulso — estudio de live coding de Drum & Bass

Ecosistema propio estilo Strudel: motor de patrones (Node + navegador), motor de audio Web Audio
(synths, batería/breaks/FX sintetizados, sidechain, export WAV), estudio web, biblioteca de temas,
generador de temas y sesión compartida para que Claude componga en vivo con el usuario.
Sin dependencias: sólo Node ≥ 20 y un navegador. Todo el texto de cara al usuario va en español.

## Comandos

- `npm start` → servidor en http://localhost:5173 (estudio), `/test/audio.html` (tests de audio),
  `/tools/render.html` (análisis de mezcla), `/strudel/` (Strudel original para comparar).
- `npm test` → toda la batería de Node (debe quedar en verde SIEMPRE tras tocar `src/` o `tracks/`).
- `node tools/pulso.js check [archivo|id]` → valida temas (sin argumentos: toda la biblioteca).
- `node tools/pulso.js info <archivo|id>` → qué suena en cada sección, rangos de notas, voces, avisos.
- `node tools/pulso.js new <estilo> [semilla] [id]` → genera un tema en `tracks/` y lo registra.
- `node tools/pulso.js save <archivo> <id> [estilo] [título]` → guarda un código (p. ej. `live/sesion.js`) como tema.
  Con errores del analizador nunca se guarda; con avisos hace falta `--force`. `--overwrite` sustituye un tema
  existente conservando su título/estilo/descripción si no se dan otros. Estilo validado contra `tracks/styles.js`.
- `node tools/pulso.js live <archivo|id>` → copia un tema a `live/sesion.js`.
- `node tools/pulso.js index` → regenera `tracks/index.js` (conserva el orden, añade los nuevos; identificadores
  sintéticos). Los estilos viven en `tracks/styles.js`, que no se regenera.

## Componer con el usuario (sesión compartida)

1. El usuario abre el estudio y activa **Sesión → Enlazar con live/sesion.js**.
2. Lo que el usuario toca (Ctrl+Enter) se guarda en `live/sesion.js`; el estado (pistas, BPM,
   errores, avisos, sección elegida `from`, bucle `loop` y compás `cycle`) en `live/estado.json`. Léelos antes de cambiar nada.
   `estado.json` no va en git (lo reescribe el estudio): si no existe, el usuario aún no ha tocado con la sesión enlazada.
3. Edita `live/sesion.js`. El estudio lo recarga solo y, si está sonando, cambia en vivo sin parar.
   Si el usuario tiene cambios sin tocar, le aparece un aviso para elegir (nunca se pisa su código).
   El eco se detecta por contenido, así que puedes guardar varias veces seguidas sin problema.
4. Antes de guardar, valida: `node tools/pulso.js info live/sesion.js` (cero errores ✖).
5. Para "escuchar" la mezcla: abre en el navegador integrado
   `http://localhost:5173/tools/render.html?file=live/sesion.js&solo=1&auto=1` y lee `window.__analysis`
   (RMS/pico por sección, energía sub/graves/medios/agudos, anchura estéreo, nivel por pista, avisos).
6. Haz cambios musicales pequeños e iterativos y explica qué cambiaste; no reescribas todo el tema
   salvo que lo pidan.

## Escribir temas

- 1 ciclo = 1 compás. Tempo DnB con `bpm(170..176)` (jungle 160–168).
- Estructura con `const F = form("intro:8 build:8 drop:16 break:8 drop2:16 outro:8")` y pistas
  `nombre: F({ "drop drop2": patrón, break: otro })`. Ninguna sección debe quedar en silencio.
- Variantes A/B: `bass: ...` y `_bass: ...` a la vez → suena la que no lleva `_` y no cuenta como duplicado
  (dos definiciones que suenan sí son error del analizador). La variante en reserva también se valida: sus
  errores salen como `pista "bass" (variante en reserva): ...`.
- Arpegios sobre acordes: índices con `n("0 2 4 3").chord(prog).voicing()` (el 4 de un acorde de 4 notas sube
  una octava); modos con `chord(prog).arp("up")`. `.arp("0 1 2")` sobre notas apiladas usa el orden de la pila.
- Nombres de pista habituales: `drums`, `bass`/`sub`, `pads`, `keys`, `lead`, `fx`, `atmos`.
- Sidechain: el kick lleva `.duck("bass:pads")` apuntando a pistas que existen (lo valida el analizador), o
  `.duckorbit(2)` con `.orbit(2)` en el destino. Semántica de Strudel: `duckonset` = bajada, `duckattack` =
  vuelta al volumen (`duckrelease` es alias), `duckhold` = mantener (extra de Pulso).
- Bajos con `chord(prog).rootNotes("e1")` (fundamental entre E1 y Eb2) o notas `d1`–`g2`. El analizador avisa
  por debajo de D1 y de `subosc` que caería por debajo de 30 Hz (el motor omite esas capas).
- Compatibilidad con Strudel: euclídeo rotado hacia la derecha (`bd(3,8,2)` = 0, 1/4, 5/8), `<a@3 b>` alarga,
  `"0 .. 3"` ocupa un paso, samples a su altura original con `note("c2")`, `arp` sobre notas apiladas,
  `:` en mini-notación (`"bd:<0 3>"`, `.distort("8:.4")`), `chunk` con `repeatCycles`, `ftype(0|1|2)`,
  `size` > 1 = segundos de cola (≤ 1 = escala 0–1 de Pulso), velocidad MIDI = gain × velocity,
  `undegradeBy(x)` deja pasar 1 − x (complementa a `degradeBy(1 − x)`), `ribbon` con duraciones fraccionarias.
  `beat(pasos, div)`: los pasos son un conjunto (comas, espacios, arrays o rangos `"0 .. 3"`), cada uno puede ser patrón.
- Sólo sonidos internos en `tracks/` (funcionan sin internet): ver `src/audio/drums.js` (`KIT`, `brk`)
  y `SYNTHS` en `src/audio/params.js`. Chuleta completa de la API: `src/ui/reference.js`.
- Archivos de `tracks/`: `export default { id, title, style, description, code }`, con `code` entre
  backticks y **sin** backticks ni `${` dentro. Estilos válidos: ver `STYLE_NAMES` en `tracks/index.js`.
- Tras añadir o cambiar temas: `node tools/pulso.js check` y `npm test`. Los tests de `test/songs.test.js`
  exigen cero errores y cero avisos en cada tema.

## Arquitectura

- `src/core/` (sin audio): `fraction.js` tiempo racional exacto · `pattern.js` patrones y
  transformaciones · `mini.js` mini-notación · `theory.js` notas/escalas/acordes · `controls.js`
  parámetros · `eval.js` evaluador estilo Strudel (`nombre:`, `$:`, `_mute:`) · `scheduler.js`.
- `src/audio/`: `engine.js` (tiempo real + render offline por bloques con `suspend`; sin él, como en Firefox, todo de una vez) · `voice.js`
  (grafo por voz) · `params.js` (resolución pura de parámetros, testeada en Node) · `mixer.js`
  (bus por pista, sidechain, reverb, delay, master con anti-DC + compresor + limitador + clipper) ·
  `drums.js` (kit sintetizado) · `samples.js` (formato `strudel.json`, carpetas locales) · `wav.js`.
- `src/tools/analyze.js`: validación/descripción estática (la usan tests y CLI).
  `src/tools/indexer.js`: índice y guardado de temas (CLI y servidor).
- `src/ui/`: estudio (`app.js`), estilos, chuleta. `server.js`: estáticos + SSE + guardado en `live/` +
  `POST /__library` (guardar en biblioteca: 400 con errores, 409 con avisos salvo `force=1`; el análisis corre en
  un hilo con plazo). Sólo escucha en loopback. `PULSO_LIVE` / `PULSO_TRACKS` / `PULSO_ANALYZE_MS` cambian
  carpetas y plazo (lo usan los tests para no tocar la biblioteca real).
- Export: "tema completo" con una sección elegida va desde ella hasta el final; con bucle, sólo la sección
  (el bucle es exacto también con secciones fraccionarias). Las pistas en M no existen en el export (tampoco su
  sidechain); si el editor no tiene el código que suena, mandan su `_` y el botón M. Stems sin compresor/limitador
  en el master y en WAV de 32 bits en coma flotante (la mezcla sigue en 16 bits).
- La CLI (`check`, `info`, `save`) analiza en un hilo con plazo (`PULSO_ANALYZE_MS`, 15 s por defecto): un
  `while(true)` o un `await` eterno da error y código 1. `tools/render.html?file=` sólo acepta `live/…` o `tracks/…`.
- El scheduler dispara los golpes de cada ventana en orden temporal (grupos de corte y sidechain iguales en directo
  y en el export). Las escrituras de la biblioteca van en cola (dos guardados del mismo id no se pisan).
- Errores en directo: si un compás falla, el scheduler sólo calla ese compás y avisa una vez; `evaluate`
  prueba toda la forma y dice sección y compás del error.

## Reglas

- No añadir dependencias externas ni build steps.
- Cualquier cambio en `src/` debe mantener `npm test` en verde y, si toca audio, pasar `/test/audio.html`
  (`window.__done` = todos OK).
- Un control nuevo no puede llamarse igual que un método de `Pattern` (lo comprueba `controls.js` al cargar).
