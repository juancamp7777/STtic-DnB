export default {
  id: 'horizonte',
  title: 'Horizonte',
  style: 'atmos',
  description: 'Atmospheric en Mi bemol mayor: pads muy largos, arpegios de campana, ride y vinilo.',
  code: `// Horizonte — atmospheric DnB en Mib mayor
bpm(172)
const F = form("intro:8 flow:16 break:8 flow2:16 outro:8")
const prog = "<Eb^9 Cm9 Ab^7 Bb7sus4>"

pads: chord(prog).voicing().s("supersaw")
  .attack(1.5).release(3).lpf(sine.range(900, 2400).slow(16))
  .gain(.5).room(.85).size(1)

arp: F({
  "flow break flow2": chord(prog).arp("up*2")
    .s("bell").fm(2).fmh(2).gain(.3).pan(sine.range(.2, .8).slow(4))
    .delay(.4).delayfeedback(.5).room(.6)
})

drums: F({
  "flow flow2": stack(
    s("bd:1 ~ ~ ~ ~ bd:1 ~ ~").duck("pads:sub").gain(.85),
    s("~ ~ sn:1 ~ ~ ~ sn:1 ~").gain(1.1).room(.4).size(.7),
    s("brk:1").splice(16, run(16)).gain(.35).hpf(1200),
    s("rd:1*4").gain(.25)
  ),
  break: s("rd:0*2").gain(.2)
})

sub: F({
  "flow flow2": chord(prog).rootNotes("e1").s("sub")
    .struct("x ~ ~ ~ ~ ~ x ~ ~ ~ x ~ ~ ~ ~ ~").clip(1.8).gain(.65)
})

texture: s("vinyl").slow(2).gain(.5)
`,
};
