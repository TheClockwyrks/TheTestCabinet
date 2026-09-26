## Overview

**Meltdown** is an open-field tower-defense game for the browser, played on the
floor of a reactor. Surge intruders pour in through vents cut into the casing
wall and race for the exhausts, and you stop them by building emitter towers on
the open floor. Your towers are also walls, so you do not defend a fixed lane:
you build the maze the surge must walk, winding it the long way around so your
guns have time to burn it down.

Its defining idea is heat as power. Every emitter fires harder the hotter it
runs, climbing to full power at its own redline and holding it there, but carry
one all the way to the top of the scale and it trips offline to cool, leaving a
hole in your line. The catch is that a tower sheds heat only through the faces
that touch open air, so packing your guns tight bakes their cores until they
trip. You space them out and rotate each tower before you place it, aiming its
radiator faces at the open lane. Towers come in `2x2`, `3x3` and `4x4`
footprints; the big ones hit harder but run hotter and want room. Two support
structures sculpt the heat: a thermostatic Forge that warms its neighbours toward
a setpoint, and a Sink that draws heat out, the only way to cool a boxed-in core.

Six emitters test that single idea different ways: the balanced Arc, the twitchy
fast-tripping Stutter that begs for a Sink, the huge Lance that runs cold until
you tuck it away or feed it a Forge, the splashing Bloom that runs hot in a
chokepoint, the anti-air Flak that alone can down the maze-ignoring flyers, and
the cryo Rime, which runs the rule backward and slows the surge hardest when it
stays cold. Meltdown is inspired by classic maze tower-defense games but is
entirely its own, with an original name, look, heat-as-power emitters and surge.
Defense here is about pacing heat across the floor, not just walling a path.

From the menu, PLAY opens a mode select: the standard Containment defense at
three difficulties, which set the starting money and the number of waves, plus
special modes such as a single hundred-strong onslaught, a 10,000-money flush
start, a restricted central build zone, and a one-life sudden death, each read
before it is chosen.

## Why it is a benchmark

Meltdown is a `medium` case, and what makes it medium is the number of systems
that have to hold each other up at once. Nothing in it needs physics or an
opponent to model, and every rule is stated as arithmetic over a `50 x 36` grid,
but a build has to keep all of it consistent at the same time.

- A maze that re-paths live under a grid of multi-size rotatable footprints, with
  a never-seal rule the game checks every placement against, and a flyer that
  ignores the maze entirely.
- A two-phase thermal model in which every tower is coupled to its neighbours:
  surface cooling through the faces that touch open air, conduction across shared
  edges, a thermostatic Forge and a coolant Sink, all resolved from the heats a
  frame opened with rather than in the order the towers happen to be visited.
- A damage curve that plateaus at each tower's own redline, and a trip that fires
  on a crossing rather than a state, so a tower already at the top of the scale
  and cooling does not trip again.
- An economy with four income lines, a wave progression whose type, size and
  cadence are stated as closed forms, five modes over three difficulties, eight
  screens, and a build panel with a live inspector.

A build that is nearly right in many places is told apart from one that is right.

## What a model is given

A run receives the self-contained specification and a configured TypeScript
project to build inside: the Vite, Vitest, ESLint and Prettier toolchain, and the
page with its canvas. How much more it receives depends on the engine the run
selects. On an engine run the project also carries the runtime and the case-owned
modules that name every figure the specification fixes and stand the engine up,
and the run writes the game and its debug surface against them. On an engineless
run the project carries no source at all, and the run writes the runtime as well
as the game.

The specification fixes the floor geometry, the route metric, the heat model, the
tower and surge tables, the wave progression, the economy and the mode table
exactly, and leaves the look to the build, drawn entirely in code. There are no
assets, no palette and no visual targets: what the specification asks of the
appearance is only what a player must read at a glance, such as an emitter's
color tracking its heat along a ramp and a tripped tower reading apart from an
online one. Every review point is decided by a validator derived from those
rules, and the reviewer's judgement goes into the per-domain ratings of visuals,
polish and feel.
