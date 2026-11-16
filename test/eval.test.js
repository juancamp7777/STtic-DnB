import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, transpile, splitStatements, EvalError } from '../src/core/eval.js';
import { ev } from './helpers.js';

const stmts = (code) => splitStatements(code).map((s) => code.slice(s.start, s.end));

test('splitStatements respeta cadenas, comentarios, paréntesis y continuaciones', () => {
  assert.deepEqual(stmts('a\nb'), ['a', 'b']);
  assert.deepEqual(stmts('a;b; c'), ['a', 'b', 'c']);
  assert.deepEqual(stmts('s("bd")\n  .gain(1)\n  .lpf(2)'), ['s("bd")\n  .gain(1)\n  .lpf(2)']);
  assert.deepEqual(stmts('stack(\n a,\n b\n)\nnext()'), ['stack(\n a,\n b\n)', 'next()']);
  assert.deepEqual(stmts('x = "a // no es comentario: b"\ny'), ['x = "a // no es comentario: b"', 'y']);
  assert.deepEqual(stmts("a // comentario\n// otro\nb"), ['a', 'b']);
  assert.deepEqual(stmts('a /* bloque\n multi */\nb'), ['a', 'b']);
  assert.deepEqual(stmts('a +\n b'), ['a +\n b']);
  assert.deepEqual(stmts('cond\n  ? x\n  : y'), ['cond\n  ? x\n  : y']);
  assert.deepEqual(stmts('const f = (x) =>\n  x.fast(2)'), ['const f = (x) =>\n  x.fast(2)']);
  assert.deepEqual(stmts('a // c\n  .b()'), ['a // c\n  .b()']);
  assert.deepEqual(stmts('`tpl\n with ; newline`\nz'), ['`tpl\n with ; newline`', 'z']);
  assert.deepEqual(stmts("'esc\\'aped'\nz"), ["'esc\\'aped'", 'z']);
  assert.deepEqual(stmts(''), []);
  assert.deepEqual(stmts('\n\n  // solo comentario\n'), []);
});

test('transpile: etiquetas estilo Strudel y expresiones', () => {
  assert.equal(transpile('drums: s("bd")'), '__track("drums", false, s("bd"))');
  assert.equal(transpile('_bass: x // nota'), '__track("bass", true, x) // nota');
  assert.equal(transpile('$: a\n$: b'), '__track("$1", false, a)\n__track("$2", false, b)');
  assert.equal(transpile('const a = 1'), 'const a = 1');
  assert.equal(transpile('stack(a)'), '__expr(stack(a))');
  assert.equal(transpile('F({\n  drop: x\n})'), '__expr(F({\n  drop: x\n}))', 'claves de objetos no son etiquetas');
  assert.equal(transpile('a ? b : c'), '__expr(a ? b : c)');
  assert.equal(transpile('if (x) {\n y\n}'), 'if (x) {\n y\n}');
  // el número de líneas se conserva (para reportar errores)
  const code = 'bpm(170)\n\ndrums: s("bd")\n  .gain(1)\n\nbass: note("c2")\n';
  assert.equal(transpile(code).split('\n').length, code.split('\n').length);
});

test('evaluate: pistas, tempo y forma', async () => {
  const r = await evaluate('bpm(170)\ndrums: s("bd sn")\n_bass: note("d1")\n$: s("hh*4")');
  assert.deepEqual(r.tracks.map((t) => [t.name, t.muted]), [['drums', false], ['bass', true], ['$1', false]]);
  assert.equal(Math.round(r.bpm), 170);
  assert.equal((await evaluate('setcpm(174/4)\ns("bd")')).bpm, 174);
  assert.equal((await evaluate('setcps(0.5)\ns("bd")')).bpm, 120);
  assert.equal((await evaluate('bpm(87, 2)\ns("bd")')).bpm, 174);
  assert.equal((await evaluate('s("bd")')).bpm, 174, 'tempo por defecto DnB');
  const f = await evaluate('const F = form("a:2 b:2")\nx: F({ a: s("bd") })');
  assert.equal(f.form.cycles, 4);
  assert.equal(f.form.at(2).name, 'b');
});

test('evaluate: la última expresión suelta suena si no hay pistas', async () => {
  const r = await evaluate('bpm(160)\nstack(s("bd"), s("sn"))\n');
  assert.deepEqual(r.tracks.map((t) => t.name), ['main']);
  const r2 = await evaluate('stack(s("bd"))\nbpm(160)');
  assert.equal(r2.tracks.length, 1, 'aunque la última sentencia no sea un patrón');
  const r3 = await evaluate('x: s("bd")\ns("sn")');
  assert.deepEqual(r3.tracks.map((t) => t.name), ['x'], 'con pistas, las sueltas no suenan');
  const r4 = await evaluate('s("bd").p("kick")\ns("sn").play()');
  assert.deepEqual(r4.tracks.map((t) => t.name), ['kick', 'play2']);
  const r5 = await evaluate('a: s("bd")\nhush()');
  assert.equal(r5.tracks.length, 0);
});

test('evaluate: el ámbito es aislado y permite redeclarar nombres', async () => {
  await evaluate('fuga = 5');
  assert.equal(globalThis.fuga, undefined);
  const r = await evaluate('const s = 3\nconst n = 4\nprint(s + n)');
  assert.deepEqual(r.logs, ['7']);
  const r2 = await evaluate('print(Math.max(1, 2), typeof JSON)');
  assert.deepEqual(r2.logs, ['2 object']);
});

test('evaluate: errores con número de línea', async () => {
  await assert.rejects(evaluate('bpm(170)\n\nfoo.bar()'), (e) => e instanceof EvalError && e.line === 3);
  await assert.rejects(evaluate('drums: s("bd")\n  .gain(1)\n  .noExiste()'), (e) => e.line === 3 && /noExiste/.test(e.message));
  await assert.rejects(evaluate('stack(('), /sintaxis/);
  await assert.rejects(evaluate('s("[bd")'), /Mini-notación/);
  await assert.rejects(evaluate('bpm(-1)\ns("bd")'), /Tempo inválido/);
  const r = await evaluate('x: s("bd").fast("a")');
  assert.equal(r.errors.length, 1, 'errores al consultar se reportan por pista');
  assert.equal(r.errors[0].track, 'x');
});

test('evaluate: samples() usa el hook y se espera', async () => {
  const calls = [];
  const r = await evaluate('samples("github:a/b")\nawait samples({ x: ["x.wav"] }, "base/")\ns("x")', {
    samples: async (...a) => {
      calls.push(a);
    },
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], [{ x: ['x.wav'] }, 'base/']);
  assert.equal(r.tracks.length, 1);
  // si samples() falla, el tema sigue (con aviso) usando los sonidos internos
  const bad = await evaluate('samples("x")\ns("bd")', { samples: async () => { throw new Error('404'); } });
  assert.equal(bad.tracks.length, 1);
  assert.match(bad.warnings[0], /No se pudieron cargar samples \(x\): 404/);
});

test('código pegado de Strudel funciona', async () => {
  const code = `setcpm(174/4)
$: s("bd ~ ~ ~ ~ bd ~ ~, ~ ~ sn ~ ~ ~ sn ~").color("cyan")._pianoroll()
$: note("<d1 f1>").s("sawtooth").lpf(sine.range(200, 900).slow(4)).lpq(6)
_$: s("hh*16")`;
  const r = await evaluate(code);
  assert.equal(r.tracks.length, 3);
  assert.equal(r.tracks[2].muted, true);
  assert.ok(ev(r.tracks[0].pattern).length === 4);
});
