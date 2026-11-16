export default {
  id: 'medio-tiempo',
  title: 'Medio Tiempo',
  style: 'halftime',
  description: 'Halftime a 170 en Mi menor: snare en el tercer tiempo, 808 con distorsión y campanas FM.',
  code: `// Medio Tiempo — halftime en Mi menor
bpm(170)
const F = form("intro:8 drop:16 break:8 drop2:16 outro:4")

drums: F({
  intro: s("hh:3*8").gain("[.3 .5]*4"),
  "drop drop2": stack(
    s("bd:2 ~ ~ ~ ~ ~ bd:2 ~ ~ ~ ~ ~ ~ ~ ~ ~").duck("bass").gain(.85),
    s("~ ~ ~ ~ ~ ~ ~ ~ sn:3 ~ ~ ~ ~ ~ ~ ~").gain(1.15).room(.3).size(.6),
    s("hh:1*8").gain("[.35 .2 .5 .2]*2"),
    s("perc:1").struct("~ ~ ~ x ~ ~ ~ ~ ~ ~ ~ ~ ~ x ~ ~").gain(.35).pan(.3)
  ),
  break: s("~ ~ sn:5 ~").slow(2).gain(.4).room(.8)
})

bass: F({
  "drop drop2": note("<e1 [e1 ~ ~ g1] c2 [d2 b1]>")
    .s("b808").clip(1.5).distort(1).gain(.5)
    .superimpose(x => x.s("reese").distort(.3).lpf(1000).wob(2).wobdepth(3).gain(.55))
})

bells: F({
  "intro break drop2 outro": n("0 ~ 3 ~ 4 ~ 7 ~").slow(2).scale("E4:minor")
    .s("bell").gain(.28).room(.7).size(.8).delay(.3)
})

pad: F({
  "intro break": chord("<Em9 C^7>").slow(2).voicing().s("supersaw")
    .attack(1.2).release(2.5).lpf(1100).gain(.35).room(.8),
  "drop drop2": chord("<Em9 C^7>").slow(2).voicing().s("supersaw")
    .attack(.4).release(1.5).lpf(1800).gain(.3).room(.6)
})

fx: F({
  intro: s("<~ ~ ~ ~ ~ riser:0 ~ ~>").gain(.4),
  "drop drop2": s("<impact ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~>").gain(.5)
})
`,
};
