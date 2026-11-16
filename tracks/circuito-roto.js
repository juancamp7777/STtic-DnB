export default {
  id: 'circuito-roto',
  title: 'Circuito Roto',
  style: 'neuro',
  description: 'Neurofunk en Fa menor: reese distorsionado con wobble sincronizado al tempo, golpes duros.',
  code: `// Circuito Roto — neurofunk en Fa menor
bpm(172)
const F = form("intro:8 drop:16 break:8 drop2:16 outro:4")

atmos: F({
  "intro break": chord("<Fm9 Db^7>").slow(2).voicing().s("supersaw")
    .attack(1).release(3).lpf(900).gain(.38).room(.8).size(1)
})

drums: F({
  intro: s("hh:2*16").gain("[.25 .45]*8").hpf(8000),
  "drop drop2": stack(
    s("bd:2 ~ ~ ~ ~ ~ ~ ~ ~ ~ bd:2 ~ ~ ~ ~ ~").duck("bass").gain(.85),
    s("~ ~ ~ ~ sn:3 ~ ~ ~ ~ ~ ~ ~ sn:3 ~ ~ ~").gain(1.15).room(.2).size(.3),
    s("~ ~ ~ ~ ~ ~ ~ [~ sn:4] ~ [~ sn:4] ~ ~ ~ ~ ~ sn:4?").gain(.35),
    s("hh:2*16").gain("[.22 .42]*8").sometimesBy(.15, x => x.ply(2)),
    s("rim").struct("~ ~ x ~ ~ ~ ~ x ~ ~ x ~ ~ ~ ~ ~").gain(.4).pan(.7)
  ),
  break: s("~ ~ sn:5 ~").slow(2).room(.6).size(.9).gain(.55),
  outro: s("bd:2 ~ ~ ~").gain(.8)
})

bass: F({
  "drop drop2": note("<f1 f1 db2 [eb1 c2]>")
    .struct("x ~ ~ x ~ ~ x ~ ~ ~ x ~ x ~ ~ ~")
    .s("reese").detune(.25).distort(1.5)
    .lpf("<700 1200 700 1800>").lpq(8)
    .wob("<2 4 [8 4] 16>").wobdepth(2)
    .clip(1.6).gain(.75)
    .superimpose(x => x.s("sub").distort(0).wob(0).lpf(200).gain(.4))
})

fx: F({
  intro: s("<~ ~ ~ ~ ~ ~ [~ riser:1] ~>").gain(.4),
  "drop drop2": stack(
    s("zap").struct("~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ x ~").sometimesBy(.5, x => x.speed(1.5)).gain(.35),
    s("<impact ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~>").gain(.5)
  )
})
`,
};
