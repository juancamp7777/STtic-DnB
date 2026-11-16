export default {
  id: 'rodillo-nocturno',
  title: 'Rodillo Nocturno',
  style: 'roller',
  description: 'Roller minimal en Do menor: bajo rodante con envolvente de filtro, shaker y percusión euclídea.',
  code: `// Rodillo Nocturno — roller en Do menor
bpm(174)
const F = form("intro:8 roll:16 break:8 roll2:16 outro:8")

drums: F({
  intro: stack(
    s("sh:0*16").gain("[.3 .5]*8"),
    s("rim(5,16,14)").gain(.35)
  ),
  "roll roll2": stack(
    s("bd:0 ~ ~ ~ ~ bd:0 ~ ~").duck("bass"),
    s("~ ~ sn:0 ~ ~ ~ sn:0 ~"),
    s("sh:0*16").gain("[.3 .55]*8"),
    s("brk:2").splice(16, run(16)).hpf(900).gain(.35),
    s("rim(5,16,14)").gain(.3).pan(.65)
  ),
  outro: s("sh:0*16").gain("[.25 .4]*8")
})

bass: F({
  "roll roll2": note("c2").add(note("<0 0 3 [5 3]>"))
    .struct("x ~ x x ~ x x ~ x ~ x x ~ x x x")
    .s("reese").lpf(600).lpenv(2.5).lpdecay(.12).lpq(6)
    .clip(.8).gain(.65).subosc(.25)
})

stab: F({
  "roll roll2": chord("<Cm9 ~ ~ Abmaj7>").voicing()
    .struct("~ ~ ~ ~ ~ ~ x ~").s("pluck").gain(.45)
    .delay(.5).delayfeedback(.55).room(.5),
  "intro break outro": chord("<Cm9 Abmaj7 Fm9 G7sus4>").voicing().s("supersaw")
    .attack(.8).release(2).lpf(sine.range(700, 1800).slow(8)).gain(.38).room(.8).size(.9)
})

perc: F({
  break: s("sh:1*8").gain(perlin.range(.15, .35)).pan(sine.range(.3, .7))
})

fx: F({
  intro: s("<~ ~ ~ ~ ~ riser:0 ~ ~>").gain(.4),
  "roll roll2": s("<cr ~ ~ ~ ~ ~ ~ ~>").gain(.4)
})
`,
};
