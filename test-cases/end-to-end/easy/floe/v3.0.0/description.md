## Overview

**Floe** is a single-screen arcade crossing game for the browser. A small tundra
critter starts on the near shore of a frozen strait and works its way to the far
side, hopping one tile at a time: first across eight lanes of sliding traffic,
then over a solid median shelf, then across eight lanes of open water by riding
the floes drifting along them. The far shore is a wall of ice cut by five bays,
and a level is done when all five are filled.

Its defining idea is the hunter. A polar bear emerges on the near shore behind
you and pursues you across the whole strait. It glides the same grid you hop,
routes around the same traffic you dodge, and swims out over the open water after
you, staying trackable as a silhouette and a wake when it submerges. Its one
limit is speed: it moves a touch slower than a cleanly played crossing, so
decisive forward hopping keeps you ahead, but hesitate, backtrack, get boxed in
by a plow, or fumble a floe and it closes and catches you. There is no lane to
wait in and no tile that is safe by being far from a hazard; the only safety is a
bay, or a crossing you have not begun yet.

Around that chase sits the rest of the run. A per-crossing timer costs you a life
if it runs down. A bonus catch surfaces in one open bay at a time and pays out
for the crossing that ends in it. Eight levels speed every lane up, thin the gaps
between the vehicles and the floes, and from the fifth send a second bear out
behind the first.

Floe is inspired by classic single-screen crossing games but is entirely its own,
with an original name, look, arctic strait, drifting carry-floes and pursuing
hunter. The game here is a chase across the ice, not just a puzzle of timing the
lanes.

## Why it is a benchmark

Floe is a large build for an easy case, and its size is in breadth rather than in
any one hard problem. There is no physics and no opponent to tune by feel: the
strait is a `40 x 20` grid of `32`-unit tiles and every rate is a constant. What
it asks for is a lot of exact rules holding at once.

- Sixteen lanes of traffic, evenly populated and wrapping at the edges without
  breaking their spacing, each scaling in speed and thinning in gap with the
  level.
- A carry model: a floe drifts a rider with it at the lane's speed, deep water
  drowns anything standing on it, and a rider carried off either edge of the
  stage is lost.
- A hunter that glides continuously between tile centres rather than stepping
  tile to tile, reads where the critter is, routes around moving traffic with a
  look-ahead, swims at a slower speed than it runs, is knocked out by a vehicle
  that arrives on it, and catches on a distance between centres.
- Five bays with a bonus catch on its own cadence, a per-crossing timer, three
  lives with a death pause between them, an eight-level run with a victory and a
  loss, and every score figure exact.
- Six screens, a HUD, ten audio cues, and a simulation on a fixed `120` Hz
  timestep.

Every one of those is stated exactly and checked exactly, so a build that is
nearly right in many places is told apart from one that is right.

## What a model is given

A run receives the self-contained specification, the seeded sprite art the game
draws its critter, bear, vehicles and floes from, and a configured TypeScript
project to build inside: the Vite, Vitest, ESLint and Prettier toolchain, and the
page with its canvas. How much more it receives depends on the engine the run
selects. On an engine run the project also carries the runtime and the
case-owned modules that name every figure the specification fixes and stand the
engine up, and the run writes the game and its debug surface against them. On an
engineless run the project carries no source at all, and the run writes the frame
loop, the fixed-tick accumulator, the canvas fit, the keyboard, the audio and the
overlay as well as the game.

The specification fixes the strait's geometry, the hop and every rule that
refuses one, the two bands, the bays, the bear, the run and the scoring exactly.
The art is supplied, and the palette, the type, the HUD layout and everything
else about the look are left to the build. Every review point is decided by a
validator derived from those rules, and the reviewer's judgement goes into the
per-domain ratings of visuals, polish and feel.
