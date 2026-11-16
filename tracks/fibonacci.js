export default {
  id: "fibonacci",
  title: "Fibonacci",
  style: "atmos",
  description: "La música es matemática: secciones de 8, 5, 13, 8, 21 y 3 compases, 89 × 2 = 178 BPM y una melodía hecha con la sucesión de Fibonacci módulo 7.",
  code: `// Fibonacci — la música es matemática
// 0 1 1 2 3 5 8 13 21... cada número es la suma de los dos anteriores.
// · Las secciones duran números de Fibonacci: 8, 5, 13, 8, 21 y 3 compases.
//   Drop y break: 13 / 8 = 1,625; drop2 y drop: 21 / 13 ≈ 1,615. Cada vez más cerca de φ ≈ 1,618.
// · Tempo: 89 (de Fibonacci) × 2 = 178 BPM.
// · Melodía: módulo 7, la sucesión se repite cada 16 números (periodo de Pisano):
//   16 semicorcheas exactas sobre las 7 notas de La menor.
// · Armonía: un ciclo de 5 acordes (otro número de Fibonacci). 8, 13 y 21 no son múltiplos de 5,
//   así que cada sección deja el ciclo a medias (13 = 2 · 5 + 3) y la siguiente vuelve a empezar en Am9.
// · Ritmo: el bajo cae en los pasos 0, 3, 5, 8 y 13 del compás; el rim reparte 5 golpes en 8;
//   en el segundo drop, un shaker reparte 8 golpes en 13. En el break, el break de batería se trocea
//   en el orden de fib(8, 8) sobre una caja en 2 y 4.
bpm(178)
const F = form("intro:8 build:5 drop:13 break:8 drop2:21 outro:3")
const prog = "<Am9 F^7 Dm9 Em7 C^9>"
const pisano = n(fib(16, 7)).scale("A4:minor")

pads: F({
  "intro build break outro": chord(prog).voicing().s("supersaw")
    .attack(.8).release(2).lpf(sine.range(900, 2200).slow(13)).gain(.45).room(.7).size(.9),
  "drop drop2": chord(prog).voicing().s("supersaw")
    .attack(.3).release(1.4).lpf(2600).gain(.5).room(.6).size(.8)
})

keys: F({
  intro: pisano.s("bell").gain(.26).lpf(3000).delay(.4).delayfeedback(.45).room(.5),
  "build drop break drop2": pisano.s("pluck").gain(.6).lpf(3600)
    .delay(.35).delayfeedback(.4).room(.35).pan(sine.range(.3, .7).slow(8)),
  outro: pisano.s("bell").gain(.22).lpf(2600).delay(.5).delayfeedback(.55).room(.7)
})

drums: F({
  intro: s("hh:3*8").gain(fib(8, 3).mul(.08).add(.12)).hpf(6000),
  build: stack(
    s("bd:0 ~ ~ ~ ~ ~ ~ ~").duck("bass:pads"),
    s("hh*16").gain(fib(16, 5).mul(.07).add(.25)),
    s("rim(5,8)").gain(.35)
  ),
  "drop drop2": stack(
    s("bd:0 ~ ~ ~ ~ bd:0 ~ ~").duck("bass:pads").gain(.85),
    s("~ ~ sn:0 ~ ~ ~ sn:0 ~").gain(1.1).room(.15),
    s("hh*16").gain(fib(16, 5).mul(.08).add(.28)).pan(perlin.range(.35, .65)),
    s("rim(5,8)").gain(.3).pan(.62)
  ),
  break: stack(
    s("brk:1").splice(8, fib(8, 8)).gain(.95).hpf(250),
    s("~ sn:0 ~ sn:0").gain(.7).room(.2)
  ),
  outro: s("hh:3*8").gain(.15).hpf(6000)
})

perc: F({
  drop2: s("sh(8,13)").gain(.4).pan(.38).hpf(3000)
})

bass: F({
  build: chord(prog).rootNotes("e1").struct("x ~ ~ ~ ~ ~ ~ ~")
    .s("sub").decay(.8).sustain(.4).gain(.6),
  "drop drop2": chord(prog).rootNotes("e1").beat("0,3,5,8,13", 16).clip(2)
    .s("sub").decay(.4).sustain(.6).release(.1).gain(.65)
    .superimpose(x => x.s("reese").lpf(1000).distort(.3).gain(.45))
})

fx: F({
  build: s("<~ ~ riser:0 ~ ~>").gain(.45),
  drop: s("<[impact,cr] ~ ~ ~ ~ ~ ~ ~ cr ~ ~ ~ ~>").gain(.55),
  break: s("<down ~ ~ ~ ~ ~ ~ ~>").gain(.4),
  drop2: s("<[impact,cr] ~ ~ ~ ~ ~ ~ ~ cr ~ ~ ~ ~ cr ~ ~ ~ ~ ~ ~ ~>").gain(.55)
})`,
};
