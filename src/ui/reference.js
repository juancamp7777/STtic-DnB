// Chuleta de referencia (HTML) para la pestaña Ayuda.
export const HELP_HTML = `
<div class="help">
<h4>Atajos</h4>
<ul>
<li><code>Ctrl+Enter</code> evaluar y tocar (cambia en vivo sin cortar)</li>
<li><code>Ctrl+.</code> parar · <code>Ctrl+S</code> guardar · <code>Ctrl+/</code> comentar línea</li>
<li>Arriba: <b>Desde…</b> empieza en una sección · <b>bucle</b> repite esa sección</li>
</ul>
<h4>Estructura</h4>
<p><code>bpm(174)</code> tempo (también <code>setcpm(174/4)</code>, <code>setCps</code>…). 1 ciclo = 1 compás.</p>
<p><code>drums: s("bd ~ sn ~")</code> pista con nombre (acepta acentos: <code>batería:</code>).</p>
<p><code>_drums:</code> o <code>drums_:</code> pista silenciada · <code>$: ...</code> pista sin nombre · <code>.p("nombre")</code></p>
<p>Variantes A/B: <code>bass: ...</code> y <code>_bass: ...</code> a la vez → suena la que no lleva <code>_</code> (cambia el <code>_</code> de sitio para alternar)</p>
<p><code>const F = form("intro:8 drop:16 break:8 fill:0.5 drop2:16")</code> forma de canción (admite medios compases).</p>
<p><code>bass: F({ "drop drop2": ..., break: ... })</code> qué suena en cada sección.</p>
<h4>Mini-notación</h4>
<ul>
<li><code>"bd sn"</code> secuencia · <code>"[bd bd] sn"</code> subdivisión · <code>"&lt;a b&gt;"</code> uno por ciclo</li>
<li><code>"hh*16"</code> repetir · <code>"pad/2"</code> más lento · <code>"bd!3"</code> copiar · <code>"a@3 b"</code> alargar</li>
<li><code>"&lt;d1@3 f1&gt;"</code> d1 dura 3 compases · <code>"0 .. 7"</code> rango · <code>"{a b c}%4"</code> polimetría</li>
<li><code>"bd(3,8)"</code> euclídeo · <code>"bd(3,8,2)"</code> rotado (como Strudel) · <code>"sn?"</code> a veces · <code>"[bd, hh*4]"</code> capas · <code>"a | b"</code> azar</li>
<li><code>"bd:2"</code> variante · <code>"bd:2:0.5"</code> variante y ganancia · <code>"~"</code> silencio · <code>"a _ _ b"</code> alargar</li>
<li><code>:</code> une valores como en Strudel: <code>"bd:&lt;0 3&gt;"</code> · <code>.lpf("&lt;400 800&gt;:8")</code> · <code>.distort("8:.4")</code></li>
<li>Las cadenas admiten métodos como en Strudel: <code>n("0 2 4".add("&lt;0 3&gt;"))</code></li>
</ul>
<h4>Sonidos internos</h4>
<p>Batería: <code>bd sn sd hh oh cp rim rd cr tom lt mt ht sh tb cb perc</code> (variantes <code>:0..5</code>)</p>
<p>Breaks: <code>brk:0..3</code> → <code>s("brk:0").splice(16, run(16))</code> · reordenar cuartos: <code>.bite(4, "0 2 1 3")</code> · <code>.shuffle(8)</code> <code>.scramble(8)</code></p>
<p>FX: <code>riser down impact zap vinyl</code></p>
<p>Synths: <code>sub sine saw square tri supersaw reese b808 fm bell pluck organ white pink brown</code></p>
<h4>Notas y armonía</h4>
<p><code>note("d1 f1")</code> · <code>n("0 2 4").scale("D:minor")</code> · <code>chord("&lt;Dm9 Bb^7 A7alt&gt;").voicing()</code> (cifrado iReal)</p>
<p><code>.anchor("c5").mode("below|above|duck|root").offset(1)</code> (o <code>.mode("below:c5")</code>) controlan el voicing · <code>n("0 1 2 3").chord("C").voicing()</code> arpegia</p>
<p><code>.rootNotes("e1")</code> fundamental en rango de sub · <code>.arp("0 [0,2] 1")</code> o <code>.arp("up")</code> sobre notas apiladas · <code>.add(note(12))</code></p>
<h4>Sonido</h4>
<p><code>.gain .pan .lpf .lpq .hpf .bpf .attack .decay .sustain .release .adsr("a:d:s:r") .clip</code></p>
<p>Compuestos de Strudel: <code>.lpf("800:8")</code> <code>.room(".5:.8")</code> <code>.delay(".5:.125:.6")</code> <code>.vib("4:.2")</code> (alias <code>.v</code>) <code>.distort("8:.4")</code> <code>.shape(".6:.8")</code> (segundo valor = volumen)</p>
<p><code>.lpenv(3).lpdecay(.1)</code> (también <code>hpenv bpenv</code>) · <code>.ftype("24db")</code> o <code>.ftype(0|1|2)</code> (12db/ladder/24db) · <code>.wob(4).wobdepth(2)</code> wobble sincronizado</p>
<p><code>.distort .distortvol .shape .shapevol .crush .coarse .phaser .vowel("a e") .room .size .delay .delaysync(3/16) .delayfeedback</code></p>
<p><code>.size(0..1)</code> elige la reverb (corta → larga); <code>.size(2)</code> o más = segundos de cola, como <code>roomsize</code> en Strudel</p>
<p><code>.detune .unison .spread .subosc .noise .fm .fmh .fmattack .fmdecay .vib .vibmod (.vmod) .penv(24).pdecay(.05) .speed .begin .end .cut .fit()</code></p>
<p>Los samples aceptan ADSR: <code>s("oh").decay(.1)</code> · tono: <code>note("c2")</code> = altura original</p>
<p><b>Sidechain:</b> <code>s("bd*4").duck("bass:pads")</code> o por orbit <code>.duckorbit(2)</code> con <code>.orbit(2)</code> en el destino (<code>.duckdepth .duckonset .duckhold .duckattack</code>).</p>
<p><b>MIDI:</b> <code>note("c3 e3").midi()</code> o <code>.midi("nombre del puerto").midichan(2)</code> (velocidad = <code>gain × velocity</code>, como Strudel)</p>
<h4>Transformaciones</h4>
<p><code>fast slow early late rev ply chop striate slice splice bite shuffle scramble loopAt segment range</code></p>
<p><code>every(4, x=&gt;x.fast(2)) lastOf sometimesBy(.3, f) often rarely degradeBy undegradeBy undegrade mask struct euclid euclidLegato euclidLegatoRot</code></p>
<p><code>beat("0,7,10", 16)</code> golpes en esos pasos (también <code>"0 &lt;4 6&gt; 10"</code> o <code>"0 .. 3"</code>) · <code>.struct("1 0 0 1".lastOf(4, invert))</code></p>
<p><code>off(1/8, f) superimpose layer jux echo echoWith(3, 1/8, (x, i) =&gt; ...) iter palindrome within swingBy linger ribbon hurry</code></p>
<p><code>chunk(4, f)</code> (un cuarto distinto cada ciclo) · <code>chunkBack</code> · <code>fastChunk</code> · <code>repeatCycles(2)</code> repite cada ciclo · <code>.inv()</code> invierte verdadero/falso</p>
<p><code>"&lt;0 1&gt;".pick([a, b])</code> (o un objeto por nombre) · <code>.pickmod</code> da la vuelta al índice · <code>.inhabit</code> y <code>squeeze("&lt;0 1&gt;", [a, b])</code> meten el ciclo entero en el paso · <code>.inhabitmod</code></p>
<p><code>polymeter("c eb g", "c2 g2")</code> · <code>s("bd").stack(s("hh*8"))</code> · <code>wchooseCycles([s("bd*4"), 3], [s("bd*8"), 1])</code> (alias <code>wrandcat</code>)</p>
<p>Señales: <code>sine saw tri square rand perlin irand(8)</code> + <code>.range(a,b)</code> <code>.slow(8)</code> <code>.segment(16)</code> · <code>slider(.5)</code> = valor fijo</p>
<h4>Extras</h4>
<p><code>all(x =&gt; x.lpf(800))</code> transforma todas las pistas · <code>define("tuneo", (p, f) =&gt; p.lpf(f))</code> o <code>register("tuneo", (f, pat) =&gt; pat.lpf(f))</code> (estilo Strudel)</p>
<p><b>Sesión</b>: enlaza el estudio con <code>live/sesion.js</code> para que Claude edite el tema contigo en vivo.</p>
<p><b>Exportar</b>: ⤓ WAV exporta lo que suena en el mezclador (mute/solo/volúmenes). Con una sección elegida: "tema completo" va desde ella hasta el final; con bucle, sólo esa sección.</p>
<p>⤓ Stems = un WAV por pista (con el sidechain de las demás, sin el compresor/limitador del master; WAV de 32 bits en coma flotante, así nada se recorta).</p>
<p><b>Biblioteca</b>: "Mis temas" → Guardar en biblioteca escribe el tema en <code>tracks/</code> (si el analizador da avisos, pregunta antes).</p>
<h4>Más que Strudel</h4>
<ul>
<li>Batería, breaks y FX sintetizados: funciona sin internet.</li>
<li><code>form()</code> con secciones con nombre, tocar desde una sección y bucle.</li>
<li>Mezclador con mute/solo/volumen (también para reverb y delay), sidechain entre pistas, stems.</li>
<li>Generador de temas por estilo, análisis de mezcla y sesión en vivo con Claude.</li>
</ul>
<p class="hint">¿Quieres comparar con el Strudel original? Abre <a href="strudel/" style="color:var(--accent)">/strudel/</a>.</p>
</div>`;
