export default {
  id: 'selva-amen',
  title: 'Selva Amen',
  style: 'jungle',
  description: 'Jungle a 165: break troceado con variaciones por ciclo, sub largo, cuerdas y stabs de órgano.',
  code: `// Selva Amen — jungle en La menor
bpm(165)
const F = form("intro:8 main:16 break:8 main2:16 outro:8")
const prog = "<Am9 F^7 Dm9 E7sus4>"
const chops = "<[0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15] [0 1 2 3 4 5 6 7 0 1 10 11 12 13 [14 15] 15] [0 1 2 3 4 5 [6 6] 7 8 9 10 11 [12 12] 13 14 15] [0 0 2 3 4 5 6 7 8 9 2 3 12 [13 14] 15 [15 15]]>"

breaks: F({
  intro: s("brk:0").splice(16, run(16)).lpf(sine.range(800, 6000).slow(8)).gain(.75),
  "main main2": s("brk:0").splice(16, chops).gain(1)
    .sometimesBy(.08, x => x.speed(-1)),
  break: s("brk:1").splice(16, run(16)).hpf(2000).gain(.45),
  outro: s("brk:0").splice(16, "0 1 2 3 ~ ~ ~ ~ 8 9 10 11 ~ ~ ~ ~").gain(.65)
})

kick: F({
  "main main2": s("bd:4 ~ ~ ~ ~ ~ ~ ~ ~ ~ bd:4 ~ ~ ~ ~ ~").gain(.7).duck("sub")
})

sub: F({
  "main main2": note("<a1 a1 f1 [g1 e1]>").s("sub").attack(.01).release(.3).clip(.95).gain(.7)
})

strings: F({
  "intro break outro": chord(prog).voicing().s("supersaw")
    .attack(1).release(2).lpf(1600).gain(.38).room(.8).size(.9),
  "main main2": chord(prog).voicing().s("supersaw")
    .attack(.5).release(1).lpf(1600).gain(.32).room(.6)
})

stab: F({
  "main main2": chord(prog).voicing()
    .struct("~ ~ ~ x ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~ ~")
    .s("organ").decay(.15).gain(.42).delay(.4).room(.5)
})

fx: F({
  intro: s("vinyl").slow(2).gain(.6),
  "main main2": s("<cr ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~>").gain(.45)
})
`,
};
