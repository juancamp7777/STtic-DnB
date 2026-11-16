export default {
  id: 'amanecer',
  title: 'Amanecer',
  style: 'liquid',
  description: 'Liquid soleado en Fa mayor: acordes de órgano, arpegio pluck, sub cálido y break suave.',
  code: `// Amanecer — liquid en Fa mayor
bpm(176)
const F = form("intro:8 drop:16 break:8 drop2:16 outro:8")
const prog = "<F^9 Dm9 Bb^7 C7sus4>"

organ: chord(prog).voicing().s("organ")
  .attack(.1).release(.8).gain(.4).room(.5).lpf(2500)

pluck: F({
  "drop break drop2": n("<[0 1 2 3 4 3 2 1] [0 2 4 2 3 1 2 0]>").chord(prog).voicing()
    .s("pluck").gain(.38).pan(.4).delay(.3).room(.3)
})

drums: F({
  intro: s("sh:1*8").gain(.35),
  "drop drop2": stack(
    s("bd:1 ~ ~ ~ ~ bd:1 ~ ~").duck("sub:organ").gain(.85),
    s("~ ~ sn:1 ~ ~ ~ sn:1 ~"),
    s("hh:3*16").gain("[.25 .45]*8"),
    s("brk:0").splice(16, run(16)).gain(.3).hpf(800).lpf(9000)
  ),
  outro: s("bd:1 ~ ~ ~ ~ bd:1 ~ ~").gain(.7)
})

sub: F({
  "drop drop2": chord(prog).rootNotes("e1").s("sub")
    .struct("x ~ ~ x ~ ~ x ~ ~ ~ x ~ ~ ~ ~ ~").clip(1.2).gain(.65)
})

fx: F({
  intro: s("<~ ~ ~ ~ ~ riser:0 ~ ~>").gain(.4),
  "drop drop2": s("<cr ~ ~ ~ ~ ~ ~ ~>").gain(.45)
})
`,
};
