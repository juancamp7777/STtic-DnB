export default {
  id: 'sombras',
  title: 'Sombras',
  style: 'dark',
  description: 'Dark DnB en Si bemol menor: plucks euclídeos, kicks saturados, bajo FM metálico.',
  code: `// Sombras — dark DnB en Sib menor
bpm(172)
const F = form("intro:8 drop:16 break:8 drop2:16")

plucks: F({
  "intro break": n("0(5,8) [3 5](3,8,6)").scale("Bb3:minor").s("pluck")
    .gain(.3).lpf(1800).delay(.4).delayfeedback(.6).room(.5),
  "drop drop2": n("0(5,8) [3 5](3,8,6)").scale("Bb3:minor").s("pluck")
    .gain(.3).lpf(2600).delay(.3).room(.4)
})

drums: F({
  "drop drop2": stack(
    s("bd:2 ~ ~ ~ ~ ~ ~ ~ ~ ~ bd:2 ~ ~ bd:2 ~ ~").distort(.5).gain(.85).duck("bass:plucks"),
    s("~ ~ ~ ~ sn:5 ~ ~ ~ ~ ~ ~ ~ sn:5 ~ ~ ~"),
    s("hh:2*16").gain(perlin.range(.15, .5)),
    s("tom").struct("~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ x x").n("<0 1 2 1>").gain(.4)
  ),
  break: s("~ ~ ~ ~ sn:5 ~ ~ ~").slow(2).room(.9).size(1).gain(.4)
})

bass: F({
  "drop drop2": note("<bb1 [bb1 ~ db2 ~] gb1 [ab1 f1]>")
    .struct("x ~ ~ ~ x ~ ~ x ~ ~ x ~ ~ ~ x ~")
    .s("fm").fm(3).fmh(.5).fmdecay(.25).lpf(1500).distort(1.2).clip(1.2).gain(.65)
    .superimpose(x => x.s("sub").distort(0).lpf(180).gain(.4))
})

fx: F({
  intro: s("<~ ~ ~ ~ ~ ~ riser:1 ~>").gain(.4),
  "drop drop2": s("<impact ~ ~ ~ ~ ~ ~ ~>").gain(.45)
})
`,
};
