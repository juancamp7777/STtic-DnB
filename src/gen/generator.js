// Generador de temas: estilo + semilla -> código Pulso legible y editable.
// Determinista: la misma semilla produce siempre el mismo tema.

export function rng(seed) {
  let s = (Math.floor(Number(seed)) || 1) >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    chance: (p) => next() < p,
    float: (a, b) => a + next() * (b - a),
  };
}

const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NAMES_ES = ['Do', 'Re♭', 'Re', 'Mi♭', 'Mi', 'Fa', 'Sol♭', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];

const PROGS_MINOR = [
  [[0, 'm9'], [8, '^7'], [3, '^7'], [10, '7sus4']],
  [[0, 'm9'], [5, 'm9'], [8, '^7'], [7, '7sus4']],
  [[0, 'm7'], [10, '7'], [8, '^7'], [7, 'm7']],
  [[0, 'm9'], [3, '^9'], [5, 'm9'], [10, '9']],
  [[0, 'm11'], [8, '^9'], [5, 'm9'], [7, '7sus4']],
  [[0, 'm9'], [0, 'm9'], [8, '^7'], [10, '7sus4']],
  [[0, 'm9'], [10, '6'], [8, '^7'], [5, 'm11']],
];
const PROGS_MAJOR = [
  [[0, '^9'], [9, 'm9'], [5, '^7'], [7, '7sus4']],
  [[0, '^7'], [4, 'm7'], [5, '^9'], [7, '9']],
  [[0, '69'], [5, '^9'], [2, 'm9'], [7, '7sus4']],
  [[5, '^9'], [7, '9'], [4, 'm7'], [9, 'm9']],
];

const ADJ = ['Neón', 'Cristal', 'Humo', 'Ámbar', 'Eléctrica', 'Profunda', 'Lejana', 'Rota', 'Nocturna', 'Infinita', 'Dorada', 'Fría', 'Líquida', 'Oculta', 'Salvaje', 'Lunar'];
const NOUNS = ['Marea', 'Ciudad', 'Frecuencia', 'Órbita', 'Lluvia', 'Selva', 'Señal', 'Brisa', 'Pulsación', 'Memoria', 'Ruta', 'Tormenta', 'Calle', 'Distancia', 'Sombra', 'Corriente'];

export const GEN_STYLES = {
  liquid: { label: 'Liquid', bpm: [172, 176], major: 0.35 },
  neuro: { label: 'Neurofunk', bpm: [170, 174], major: 0 },
  jungle: { label: 'Jungle', bpm: [160, 168], major: 0.1 },
  jumpup: { label: 'Jump-up', bpm: [174, 176], major: 0 },
  halftime: { label: 'Halftime', bpm: [168, 172], major: 0 },
  roller: { label: 'Roller', bpm: [172, 175], major: 0 },
  atmos: { label: 'Atmospheric', bpm: [170, 174], major: 0.5 },
};

const KICKS = {
  twostep: ['bd ~ ~ ~ ~ ~ ~ ~ ~ ~ bd ~ ~ ~ ~ ~', 'bd ~ ~ ~ ~ ~ ~ ~ ~ ~ bd ~ ~ bd ~ ~', 'bd ~ bd ~ ~ ~ ~ ~ ~ ~ bd ~ ~ ~ ~ ~', 'bd ~ ~ ~ ~ ~ ~ bd ~ ~ bd ~ ~ ~ ~ ~'],
  half: ['bd ~ ~ ~ ~ ~ bd ~ ~ ~ ~ ~ ~ ~ ~ ~', 'bd ~ ~ bd ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ bd ~', 'bd ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ bd ~ ~ ~ ~'],
  jump: ['bd ~ ~ ~ ~ ~ bd ~ ~ ~ bd ~ ~ ~ ~ ~', 'bd ~ ~ ~ ~ ~ ~ ~ ~ ~ bd ~ ~ ~ bd ~'],
};
const SNARE_TWO = '~ ~ ~ ~ sn ~ ~ ~ ~ ~ ~ ~ sn ~ ~ ~';
const SNARE_HALF = '~ ~ ~ ~ ~ ~ ~ ~ sn ~ ~ ~ ~ ~ ~ ~';
const GHOSTS = ['~ ~ ~ ~ ~ ~ ~ sn ~ sn ~ ~ ~ ~ ~ ~', '~ ~ ~ ~ ~ ~ ~ ~ ~ sn ~ ~ ~ ~ ~ sn', '~ ~ ~ sn ~ ~ ~ ~ ~ ~ ~ sn ~ ~ ~ ~', '~ ~ ~ ~ ~ ~ ~ [~ sn] ~ ~ ~ ~ ~ ~ ~ sn?'];
const BASS_RHYTHMS = [
  'x ~ ~ x ~ ~ x ~ x ~ ~ ~ x ~ ~ ~',
  'x ~ ~ ~ ~ ~ x ~ ~ ~ x ~ ~ ~ ~ ~',
  'x ~ x ~ ~ x ~ x ~ ~ x ~ x ~ ~ ~',
  'x ~ ~ x ~ ~ x ~ ~ ~ x ~ x ~ ~ ~',
  'x ~ ~ ~ x ~ ~ x ~ ~ x ~ ~ ~ x ~',
];
const ROLL_RHYTHMS = ['x ~ x x ~ x x ~ x ~ x x ~ x x x', 'x x ~ x x ~ x ~ x x ~ x ~ x x ~', 'x ~ x x x ~ x x ~ x x ~ x x ~ x'];
const CHOPS = [
  'run(16)',
  '"<[0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15] [0 1 2 3 4 5 6 7 0 1 10 11 12 13 [14 15] 15]>"',
  '"<[0 1 2 3 4 5 [6 6] 7 8 9 10 11 [12 12] 13 14 15] [0 0 2 3 4 5 6 7 8 9 2 3 12 [13 14] 15 [15 15]]>"',
  '"0 1 2 3 4 5 6 7 8 9 10 11 [12 13] [14 15] [14 15] 15"',
];

const v = (str, sound, variant) => str.replace(new RegExp(`\\b${sound}\\b`, 'g'), `${sound}:${variant}`);
const fmt = (x) => {
  const s = (Math.round(x * 100) / 100).toString();
  return s.startsWith('0.') ? s.slice(1) : s;
};

function melody(r, steps = 8) {
  let deg = r.int(0, 4);
  const out = [];
  for (let i = 0; i < steps; i++) {
    if (i > 0 && r.chance(0.35)) {
      out.push('~');
      continue;
    }
    deg = Math.max(-2, Math.min(9, deg + r.pick([-2, -1, -1, 0, 1, 1, 2, 3])));
    out.push(String(deg));
  }
  return out.join(' ');
}

export function generateTrack({ style = 'liquid', seed = 1 } = {}) {
  const def = GEN_STYLES[style];
  if (!def) throw new Error(`Estilo desconocido: ${style}`);
  const r = rng(Number(seed) * 7919 + Object.keys(GEN_STYLES).indexOf(style) * 104729);
  const bpm = r.int(def.bpm[0], def.bpm[1]);
  const major = r.chance(def.major);
  const key = r.int(0, 11);
  const prog = r.pick(major ? PROGS_MAJOR : PROGS_MINOR);
  const chords = prog.map(([iv, q]) => NAMES[(key + iv) % 12] + q);
  const progStr = `<${chords.join(' ')}>`;
  const scale = `${NAMES[key]}4:${major ? 'major' : 'minor'}`;
  const title = `${r.pick(NOUNS)} ${r.pick(ADJ)}`;
  const half = style === 'halftime';
  const kickVar = { neuro: 2, jumpup: 4, halftime: 2, jungle: 3 }[style] ?? r.pick([0, 1]);
  const snareVar = { neuro: 3, jumpup: 0, halftime: 3, jungle: 2 }[style] ?? r.pick([0, 1]);
  const kick = v(r.pick(half ? KICKS.half : style === 'jumpup' ? KICKS.jump : KICKS.twostep), 'bd', kickVar);
  const snare = v(half ? SNARE_HALF : SNARE_TWO, 'sn', snareVar);
  const ghost = v(r.pick(GHOSTS), 'sn', 4);
  const hatSound = style === 'roller' ? 'sh:0' : `hh:${r.pick([0, 1, 3])}`;
  const hats = r.pick([`${hatSound}*16`, `[~ ${hatSound}]*8`, `${hatSound}*8`]);
  const brkVar = style === 'jungle' ? 0 : r.pick([1, 2]);
  const useBreak = style === 'jungle' || r.chance(0.55);
  const chop = r.pick(CHOPS);

  const intro = style === 'jungle' ? 8 : r.pick([8, 8, 16]);
  const formStr = r.chance(0.5) && style !== 'neuro'
    ? `intro:${intro} build:8 drop:16 break:8 drop2:16 outro:8`
    : `intro:${intro} drop:16 break:8 drop2:16 outro:4`;
  const hasBuild = formStr.includes('build');

  const L = [];
  L.push(`// ${title} — ${def.label} generado (semilla ${seed})`);
  L.push(`// Tonalidad: ${NAMES_ES[key]} ${major ? 'mayor' : 'menor'} · ${bpm} BPM`);
  L.push(`bpm(${bpm})`);
  L.push(`const F = form("${formStr}")`);
  L.push(`const prog = "${progStr}"`);
  L.push('');

  // --- armonía ---
  const padLpf = r.int(900, 2400);
  L.push(`pads: F({`);
  L.push(`  "intro break${hasBuild ? ' build' : ''}": chord(prog).voicing().s("supersaw")`);
  L.push(`    .attack(${fmt(r.float(0.5, 1.5))}).release(${fmt(r.float(1.5, 3))}).lpf(${padLpf}).gain(.42).room(.75).size(.9),`);
  L.push(`  "drop drop2 outro": chord(prog).voicing().s("supersaw")`);
  L.push(`    .attack(.3).release(1.2).lpf(${padLpf + 600}).gain(${style === 'neuro' || style === 'jumpup' ? '.28' : '.45'}).room(.6)`);
  L.push(`})`);
  L.push('');

  if (style === 'liquid' || style === 'atmos' || style === 'jungle' || r.chance(0.3)) {
    const inst = r.pick(style === 'atmos' ? ['bell', 'fm'] : ['fm', 'pluck', 'organ']);
    const arp = r.pick(['"up"', '"<[0 2 1 3 2 4 3 1] [0 1 2 3 4 3 2 1]>"', '"0 2 4 2 1 3 4 3"', '"<updown downup>"']);
    // índices numéricos: n(...).chord().voicing() (como en Strudel, el 4 de un acorde de 4 notas sube una octava);
    // modos ("up", "updown"...): .arp() sobre el acorde
    const isMode = /^"<?[a-z]/.test(arp);
    L.push(`keys: F({`);
    L.push(isMode ? `  "drop break drop2": chord(prog).arp(${arp})` : `  "drop break drop2": n(${arp}).chord(prog).voicing()`);
    L.push(`    .s("${inst}")${inst === 'fm' ? '.fm(1.5).fmh(1).decay(.35)' : ''}.gain(${inst === 'organ' ? '.32' : '.4'}).lpf(${r.int(2500, 5000)})`);
    L.push(`    .delay(.35).delayfeedback(.45).room(.4).pan(sine.range(.3, .7).slow(8))`);
    L.push(`})`);
    L.push('');
  }

  if (r.chance(style === 'jumpup' || style === 'liquid' ? 0.6 : 0.35)) {
    L.push(`lead: F({`);
    L.push(`  drop2: n("<[${melody(r)}] [${melody(r)}]>").scale("${scale}")`);
    L.push(`    .s("supersaw").detune(.4).lpf(3500).decay(.2).sustain(.35).gain(.32).room(.35).delay(.25)`);
    L.push(`})`);
    L.push('');
  }

  // --- batería ---
  L.push(`drums: F({`);
  L.push(`  intro: s("${hats}").gain("[.25 .45]*4"),`);
  if (hasBuild) {
    L.push(`  build: stack(`);
    L.push(`    s("${kick.split(' ').slice(0, 8).join(' ')} ~ ~ ~ ~ ~ ~ ~ ~").duck("bass:pads"),`);
    L.push(`    s("${hats}").gain(saw.range(.2, .6).slow(8))`);
    L.push(`  ),`);
  }
  L.push(`  "drop drop2": stack(`);
  L.push(`    s("${kick}").duck("bass:pads").gain(.85),`);
  L.push(`    s("${snare}").gain(1.15)${style === 'neuro' ? '.room(.2).size(.3)' : '.room(.12)'},`);
  L.push(`    s("${ghost}").gain(.32),`);
  L.push(`    s("${hats}").gain("[.28 .5]*8")${r.chance(0.5) ? '.swingBy(1/8, 8)' : ''}${r.chance(0.4) ? '.sometimesBy(.12, x => x.ply(2))' : ''}`);
  if (useBreak) L.push(`    , s("brk:${brkVar}").splice(16, ${chop}).gain(${style === 'jungle' ? '.85' : '.38'})${style === 'jungle' ? '' : `.hpf(${r.int(500, 1200)})`}`);
  L.push(`  ),`);
  L.push(`  outro: s("${hats}").gain("[.2 .35]*4")`);
  L.push(`})`);
  L.push('');

  // --- bajo ---
  const rhythm = r.pick(BASS_RHYTHMS);
  L.push(`bass: F({`);
  switch (style) {
    case 'neuro':
      L.push(`  "drop drop2": chord(prog).rootNotes("e1").struct("${rhythm}")`);
      L.push(`    .s("reese").detune(${fmt(r.float(0.15, 0.35))}).distort(${fmt(r.float(1, 2.5))})`);
      L.push(`    .lpf("<${r.int(500, 800)} ${r.int(900, 1300)} ${r.int(500, 800)} ${r.int(1200, 1900)}>").lpq(8)`);
      L.push(`    .wob("<${r.pick(['2 4 [8 4] 16', '4 8 4 [16 8]', '1 2 4 8'])}>").wobdepth(2).clip(1.5).gain(.7)`);
      L.push(`    .superimpose(x => x.s("sub").distort(0).wob(0).lpf(180).gain(.4))`);
      break;
    case 'jumpup':
      L.push(`  "drop drop2": chord(prog).rootNotes("e1").struct("${rhythm}")`);
      L.push(`    .s("${r.pick(['square', 'saw'])}").lpf(sine.range(300, 2600).fast(${r.pick([1, 2, 4])})).lpq(10)`);
      L.push(`    .distort(.8).clip(.9).gain(.7)`);
      L.push(`    .sometimesBy(.25, x => x.add(note(12)))`);
      break;
    case 'halftime':
      L.push(`  "drop drop2": chord(prog).rootNotes("e1").struct("x ~ ~ ~ ~ ~ x ~ ~ ~ ~ ~ x ~ ~ ~")`);
      L.push(`    .s("b808").clip(1.5).distort(1).gain(.5)`);
      L.push(`    .superimpose(x => x.s("reese").distort(.3).lpf(1000).wob(2).wobdepth(3).gain(.55))`);
      break;
    case 'roller':
      L.push(`  "drop drop2": chord(prog).rootNotes("e1").struct("${r.pick(ROLL_RHYTHMS)}")`);
      L.push(`    .s("reese").lpf(600).lpenv(2.5).lpdecay(.12).lpq(6).clip(.8).gain(.65)`);
      break;
    case 'jungle':
      L.push(`  "drop drop2": chord(prog).rootNotes("e1").s("sub").attack(.01).release(.3).clip(.95).gain(.7)`);
      break;
    default:
      L.push(`  "drop drop2": chord(prog).rootNotes("e1").struct("${rhythm}")`);
      L.push(`    .s("sub").decay(.4).sustain(.6).release(.1).gain(.65)`);
      L.push(`    .superimpose(x => x.s("reese").lpf(${r.int(900, 1400)}).distort(.4).gain(.5))`);
  }
  L.push(`})`);
  L.push('');

  // --- efectos ---
  L.push(`fx: F({`);
  // el riser (4 s) arranca ~4 s antes del final de la sección para terminar justo en el drop
  const riserLen = hasBuild ? 8 : intro;
  const riserStart = Math.max(0, riserLen - Math.ceil(4 / (240 / bpm)));
  const riserSteps = Array.from({ length: riserLen }, (_, i) => (i === riserStart ? 'riser:0' : '~')).join(' ');
  L.push(`  ${hasBuild ? 'build' : 'intro'}: s("<${riserSteps}>").gain(.4),`);
  L.push(`  "drop drop2": s("<[impact,cr] ~ ~ ~ ~ ~ ~ ~ cr ~ ~ ~ ~ ~ ~ ~>").gain(.5),`);
  L.push(`  break: s("<down ~ ~ ~ ~ ~ ~ ~>").gain(.35)`);
  L.push(`})`);
  L.push('');
  if (style === 'atmos' || style === 'jungle') L.push(`texture: s("vinyl").slow(2).gain(.45)`);

  return { title, style, seed: Number(seed), bpm, key: `${NAMES_ES[key]} ${major ? 'mayor' : 'menor'}`, code: L.join('\n') + '\n' };
}
