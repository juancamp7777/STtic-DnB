import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../src/core/scheduler.js';
import { mini, s, n, run } from '../src/core/index.js';
import { rng } from '../src/gen/generator.js';
import { show } from './helpers.js';

function harness(opts = {}) {
  let now = 0;
  const fired = [];
  const errors = [];
  const sch = new Scheduler({
    getTime: () => now,
    onTrigger: (e) => fired.push(e),
    onError: (e, t) => errors.push([e, t]),
    setTimer: () => 1,
    clearTimer: () => {},
    ...opts,
  });
  return {
    sch,
    fired,
    errors,
    advance(dt) {
      now += dt;
      sch.tick();
    },
    get now() {
      return now;
    },
  };
}

const key = (e) => `${e.track}|${e.cycle}|${show(e.value)}`;

test('con jitter aleatorio no se pierde ni se duplica ningún evento', () => {
  const r = rng(5);
  const tracks = [
    { name: 'drums', pattern: s('bd*2 [~ sn] hh*3 <cp [cp cp]>').sometimesBy(0.3, (x) => x.ply(2)) },
    { name: 'bass', pattern: n(run(7)).fast(1.5).euclid(5, 8) },
    { name: 'slow', pattern: mini('a/3 b@2') },
  ];
  const h = harness();
  h.sch.setTracks(tracks);
  h.sch.cps = 0.725;
  h.sch.start(0);
  for (let i = 0; i < 4000; i++) h.advance(r.float(0.001, 0.09));
  h.sch.stop();
  const lastCycle = h.sch.lastCycle;
  const expected = tracks.flatMap((t) => t.pattern.onsets(0, lastCycle).map((hap) => `${t.name}|${hap.whole.begin.valueOf()}|${show(hap.value)}`));
  const got = h.fired.map(key);
  assert.equal(new Set(got).size, got.length, 'duplicados');
  assert.deepEqual([...got].sort(), [...expected].sort());
  assert.ok(got.length > 1000);
});

test('la hora de cada evento corresponde a su ciclo y siempre va por delante', () => {
  const h = harness({ lookahead: 0.15, latency: 0.05 });
  h.sch.setTracks([{ name: 'x', pattern: s('hh*16') }]);
  h.sch.cps = 0.5;
  h.sch.start(0);
  let late = 0;
  for (let i = 0; i < 1000; i++) {
    const before = h.fired.length;
    h.advance(0.02);
    for (const e of h.fired.slice(before)) {
      assert.ok(Math.abs(e.time - (0.05 + e.cycle / 0.5)) < 1e-9);
      if (e.time < h.now) late++;
      assert.ok(Math.abs(e.duration - 1 / 16 / 0.5) < 1e-9);
    }
  }
  assert.equal(late, 0, 'ningún evento llega tarde con ticks regulares');
});

test('cambiar el tempo en marcha es continuo (sin huecos ni solapes)', () => {
  const h = harness();
  h.sch.setTracks([{ name: 'k', pattern: s('bd*4') }]);
  h.sch.cps = 0.5;
  h.sch.start(0);
  for (let i = 0; i < 200; i++) h.advance(0.025);
  h.sch.setCps(0.725);
  for (let i = 0; i < 200; i++) h.advance(0.025);
  h.sch.setCps(0.3);
  for (let i = 0; i < 200; i++) h.advance(0.025);
  const ev = h.fired;
  for (let i = 1; i < ev.length; i++) {
    assert.ok(ev[i].cycle > ev[i - 1].cycle, 'ciclos crecientes');
    assert.ok(ev[i].time > ev[i - 1].time, 'tiempos crecientes');
    const dc = ev[i].cycle - ev[i - 1].cycle;
    assert.ok(Math.abs(dc - 0.25) < 1e-9, `sin huecos: ${dc}`);
    const dt = ev[i].time - ev[i - 1].time;
    assert.ok(dt > 0.25 / 0.725 - 1e-6 && dt < 0.25 / 0.3 + 1e-6, `intervalo plausible ${dt}`);
  }
  assert.throws(() => h.sch.setCps(0), /cps inválido/);
});

test('si el hilo se bloquea, salta hacia adelante en vez de disparar una ráfaga', () => {
  const h = harness({ maxLate: 0.3 });
  h.sch.setTracks([{ name: 'x', pattern: s('hh*16') }]);
  h.sch.cps = 0.725;
  h.sch.start(0);
  h.advance(0.02);
  const before = h.fired.length;
  h.advance(5);
  const burst = h.fired.length - before;
  assert.ok(burst < 16, `ráfaga de ${burst}`);
  assert.equal(h.sch.stats.skips, 1);
  for (const e of h.fired.slice(before)) assert.ok(e.time >= h.now - 0.31, 'nada absurdamente tarde');
});

test('un patrón que falla no tumba a los demás', () => {
  const h = harness();
  h.sch.setTracks([
    { name: 'malo', pattern: s('bd').fast('x') },
    { name: 'bueno', pattern: s('sn*2') },
  ]);
  h.sch.start(0);
  for (let i = 0; i < 100; i++) h.advance(0.03);
  assert.equal(h.errors.length, 1, 'se reporta una sola vez');
  assert.equal(h.errors[0][1].name, 'malo');
  assert.ok(h.fired.length > 0 && h.fired.every((e) => e.track === 'bueno'));
});

test('cambio de patrones en vivo sin duplicados en la frontera', () => {
  const h = harness();
  h.sch.setTracks([{ name: 'a', pattern: s('bd*8') }]);
  h.sch.start(0);
  for (let i = 0; i < 77; i++) h.advance(0.031);
  h.sch.setTracks([{ name: 'a', pattern: s('sn*8') }]);
  for (let i = 0; i < 77; i++) h.advance(0.031);
  const cycles = h.fired.map((e) => e.cycle);
  assert.equal(new Set(cycles).size, cycles.length);
  for (let i = 1; i < cycles.length; i++) assert.ok(Math.abs(cycles[i] - cycles[i - 1] - 0.125) < 1e-9);
  assert.ok(h.fired.some((e) => e.value.s === 'bd') && h.fired.some((e) => e.value.s === 'sn'));
});

test('pistas mudas no disparan; start/stop/start', () => {
  const h = harness();
  h.sch.setTracks([
    { name: 'a', pattern: s('bd*4'), muted: true },
    { name: 'b', pattern: s('sn*4') },
  ]);
  h.sch.start(0);
  for (let i = 0; i < 50; i++) h.advance(0.03);
  assert.ok(h.fired.every((e) => e.track === 'b'));
  h.sch.stop();
  const n0 = h.fired.length;
  for (let i = 0; i < 50; i++) h.advance(0.03);
  assert.equal(h.fired.length, n0, 'parado no dispara');
  h.sch.start(0);
  h.advance(0.03);
  assert.ok(h.fired.length > n0);
  assert.equal(h.fired[n0].cycle, 0, 'vuelve a empezar desde el ciclo 0');
});
