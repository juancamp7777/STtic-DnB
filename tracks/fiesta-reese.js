export default {
  id: 'fiesta-reese',
  title: 'Fiesta Reese',
  style: 'dancefloor',
  description: 'Dancefloor en Mi menor: riff de supersaw en el drop, reese gordo, palmas y crash.',
  code: `// Fiesta Reese — dancefloor DnB en Mi menor
bpm(174)
const F = form("intro:8 build:8 drop:16 break:8 build2:4 drop2:16")
const prog = "<Em7 C^7 G Dsus4>"

drums: F({
  build: stack(
    s("bd:0*4").gain(.8),
    s("~ cp ~ cp").gain(.5),
    s("sn:2*8").gain(saw.range(.1, .6).slow(8)).mask("<0 0 0 0 1 1 1 1>")
  ),
  build2: stack(
    s("bd:0*4").gain(.8),
    s("~ cp ~ cp").gain(.5),
    s("sn:2*8").gain(saw.range(.1, .6).slow(4)).mask("<0 0 1 1>").sometimesBy(.3, x => x.ply(2))
  ),
  "drop drop2": stack(
    s("bd:0 ~ ~ ~ ~ bd:0 ~ ~").duck("bass:lead"),
    s("~ ~ [sn:0,cp:2] ~ ~ ~ [sn:0,cp:2] ~"),
    s("hh:1*16").gain("[.3 .5]*8").cut(1),
    s("~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ oh:0 ~").gain(.4).cut(1)
  )
})

bass: F({
  "drop drop2": note("<e1 c2 g1 d2>")
    .struct("x ~ x ~ ~ x ~ x ~ ~ x ~ x ~ ~ ~")
    .s("reese").detune(.2).lpf(900).lpenv(1.5).lpdecay(.2)
    .distort(.6).clip(.9).gain(.7)
})

lead: F({
  drop: note("<[e4 ~ g4 ~ b4 ~ a4 g4] [e4 ~ ~ d4 ~ e4 ~ ~]>").s("supersaw")
    .lpf(4000).decay(.18).sustain(.4).gain(.34).room(.35).delay(.25),
  drop2: note("<[e4 ~ g4 ~ b4 ~ a4 g4] [e4 ~ ~ d4 ~ e4 ~ ~]>").add(note("<0 12>")).s("supersaw")
    .lpf(5000).decay(.18).sustain(.4).gain(.34).room(.35).delay(.25)
})

chords: F({
  "intro break": chord(prog).voicing().s("supersaw").attack(.4).release(1.5)
    .lpf(1800).gain(.38).room(.7),
  build: chord(prog).voicing().s("supersaw").attack(.05).release(.3)
    .struct("x ~ x ~ x ~ x ~").lpf(saw.range(600, 4000).slow(8)).gain(.3),
  build2: chord(prog).voicing().s("supersaw").attack(.05).release(.3)
    .struct("x ~ x ~ x ~ x ~").lpf(saw.range(600, 4000).slow(4)).gain(.3)
})

fx: F({
  build: s("<~ ~ ~ ~ ~ riser:0 ~ ~>").gain(.45),
  build2: s("<~ riser:0 ~ ~>").gain(.45),
  "drop drop2": s("<[impact,cr] ~ ~ ~ ~ ~ ~ ~ cr ~ ~ ~ ~ ~ ~ ~>").gain(.55)
})
`,
};
