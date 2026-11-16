# Pulso · estudio de Drum & Bass en código

Un ecosistema completo para hacer DnB escribiendo código, al estilo de [Strudel](https://strudel.cc),
pero con motor propio y pensado para producir temas enteros.

## Arrancar

```bash
npm start
```

Abre **http://localhost:5173** en Chrome. Elige un tema de la biblioteca y pulsa **▶ Tocar**
(o `Ctrl+Enter`). `Ctrl+.` para parar, `Ctrl+S` para guardar en "Mis temas".

## Qué trae

- **Lenguaje de patrones compatible con Strudel**: mini-notación (`"bd*2 [~ sn] <a b>"`, euclídeos,
  polimetría, rangos `0 .. 7`…), `note`, `n().scale()`, `chord().voicing()`, `.arp()`, señales
  (`sine`, `perlin`…), `every`, `sometimes`, `off`, `jux`, `chop`, `splice`, `$:` y pistas con nombre.
  Puedes pegar código de Strudel y casi todo funciona igual.
- **Motor de audio propio**: synths (`sub`, `reese`, `supersaw`, `b808`, `fm`, `bell`, `pluck`,
  `organ`…), batería y breaks de jungle **sintetizados** (funciona sin internet), risers, impacts,
  vinilo, filtros con envolvente, wobble sincronizado al tempo, vocales, distorsión, reverb, delay
  sincronizado, **sidechain entre pistas** y master con limitador (nunca satura).
- **Canciones completas** con `form("intro:8 build:8 drop:16 break:8 drop2:16 outro:8")`.
- **Estudio**: editor, mezclador (mute/solo/volumen/medidor por pista), piano roll, espectro,
  biblioteca de 10 temas, **generador de temas** por estilo y semilla, tocar **desde una sección**
  y en **bucle**, exportar **WAV** (lo que suena en el mezclador) o **stems** (un WAV por pista),
  guardar en la biblioteca (`tracks/`), compartir por enlace, cargar tus samples y salida **MIDI**.
- **Sesión compartida con Claude**: activa la pestaña **Sesión** y pídele a Claude que entre a
  desarrollar el tema; sus cambios suenan en vivo sin parar la música.

## Herramientas

```bash
npm test
```

```bash
node tools/pulso.js info lluvia-de-neon
```

```bash
node tools/pulso.js new neuro
```

```bash
node tools/pulso.js save live/sesion.js mi-tema liquid "Mi tema"
```

`save` no guarda un tema con errores; si sólo tiene avisos, añade `--force`. Para sustituir uno que ya
existe (conservando su título, estilo y descripción), añade `--overwrite`.

- `http://localhost:5173/test/audio.html` → tests de audio (renderiza todos los sonidos y temas).
- `http://localhost:5173/tools/render.html` → análisis de mezcla por sección y por pista.
- `http://localhost:5173/strudel/` → el Strudel original, para comparar.
