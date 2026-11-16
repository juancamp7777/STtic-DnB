export default {
  id: 'rebote',
  title: 'Rebote',
  style: 'jumpup',
  description: 'Jump-up en Sol menor: bajo cuadrado con filtro que rebota, sección "switch" y 808 en el segundo drop.',
  code: `// Rebote — jump-up en Sol menor
bpm(175)
const F = form("intro:8 drop:16 switch:8 drop2:16 outro:4")
const riff = "<[g1 ~ g1 ~ ~ bb1 ~ g1] [g1 ~ ~ d2 ~ c2 bb1 ~]>"

drums: F({
  intro: s("hh:0*8").gain("[.5 .7]*4"),
  "drop switch drop2": stack(
    s("bd:4 ~ ~ ~ ~ ~ bd:4 ~ ~ ~ bd:4 ~ ~ ~ ~ ~").duck("bass"),
    s("~ ~ ~ ~ sn:0 ~ ~ ~ ~ ~ ~ ~ sn:0 ~ ~ ~"),
    s("~ hh:2 ~ hh:2 ~ hh:2 ~ hh:2 ~ hh:2 ~ hh:2 ~ hh:2 ~ hh:2").gain(.45),
    s("cb").struct("~ ~ ~ ~ ~ ~ ~ x ~ ~ ~ ~ ~ ~ ~ ~").gain(.25)
  ),
  outro: s("bd:4 ~ sn:0 ~").gain(.7)
})

bass: F({
  intro: note(riff).s("square").lpf(saw.range(300, 900).slow(8)).lpq(6).clip(.9).gain(.4),
  drop: note(riff).s("square").lpf(sine.range(300, 2500).fast(2)).lpq(10)
    .distort(.8).clip(.9).gain(.75),
  switch: note("[g1 ~ g1 g1]*2").s("saw").lpf(saw.range(200, 3000).fast(4)).lpq(12).gain(.55),
  drop2: note(riff).s("b808").clip(1).gain(.6)
    .sometimesBy(.3, x => x.add(note(12)))
})

lead: F({
  drop2: note("<[g3 ~ bb3 ~ d4 ~ c4 bb3] [g3 ~ ~ ~ f3 ~ g3 ~]>").s("supersaw").detune(.6)
    .lpf(3000).decay(.2).sustain(.3).gain(.3).room(.3)
})

fx: F({
  intro: s("<~ ~ ~ ~ ~ ~ riser:1 ~>").gain(.45),
  "drop drop2": s("zap:1").struct("~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ x ~ ~").gain(.3),
  switch: s("<down:1 ~ ~ ~ ~ ~ ~ ~>").gain(.4)
})
`,
};
