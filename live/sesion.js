// Lluvia de Neón — liquid DnB en Re menor
bpm(174)
const F = form("intro:8 build:8 drop:16 break:8 drop2:16 outro:8")
const prog = "<Dm9 Bb^7 Gm9 A7sus4>"

pads: F({
  "intro build break": chord(prog).voicing().s("supersaw")
    .attack(.6).release(2).lpf(1400).gain(.5).room(.7).size(.9),
  "drop drop2 outro": chord(prog).voicing().s("supersaw")
    .attack(.3).release(1.5).lpf(2200).gain(.42).room(.6).size(.8)
})

keys: F({
  "build drop break drop2": chord(prog)
    .arp("<[0 2 1 3 2 4 3 1] [0 1 2 3 4 3 2 1]>")
    .s("fm").fm(1.5).fmh(1).decay(.35).gain(.45).lpf(3500)
    .delay(.35).delayfeedback(.4).room(.4)
    .pan(sine.range(.3, .7).slow(8))
})

drums: F({
  build: stack(
    s("bd:0 ~ ~ ~ ~ ~ ~ ~").duck("bass:pads"),
    s("hh*8").gain("[.45 .7]*4")
  ),
  "drop drop2": stack(
    s("bd:0 ~ ~ ~ ~ bd:0 ~ ~").duck("bass:pads"),
    s("~ ~ sn:0 ~ ~ ~ sn:0 ~").room(.15),
    s("hh*16").gain("[.3 .55 .4 .65]*4").pan(perlin.range(.35, .65)).swingBy(1/8, 8).cut(1),
    s("~ ~ ~ ~ ~ ~ ~ oh:2").gain(.45).cut(1),
    s("brk:2").splice(16, run(16)).gain(.4).hpf(700)
  ),
  outro: s("hh*8").gain("[.35 .55]*4")
})

bass: F({
  "drop drop2": chord(prog).rootNotes(1)
    .struct("x ~ ~ x ~ ~ x ~ x ~ ~ ~ x ~ ~ ~")
    .s("sub").decay(.4).sustain(.6).release(.1).gain(.9)
    .superimpose(x => x.s("reese").lpf(380).gain(.4))
})

fx: F({
  build: s("<~ ~ ~ ~ ~ riser:0 ~ ~>").gain(.45),
  "drop drop2": s("<[impact,cr] ~ ~ ~ ~ ~ ~ ~ cr ~ ~ ~ ~ ~ ~ ~>").gain(.55),
  break: s("<down ~ ~ ~ ~ ~ ~ ~>").gain(.4)
})

// añadido por Claude desde la sesión compartida
ride: F({
  "drop drop2": s("rd:0*4").gain(.35).pan(.6)
})
