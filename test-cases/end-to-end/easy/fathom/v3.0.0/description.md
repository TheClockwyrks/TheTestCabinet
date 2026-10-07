## Overview

**Fathom** is a bioluminescent deep-sea maze chase for the browser. You are a
small glowing forager threading the flooded corridors of a pitch-dark maze,
grazing drifting plankton while three predators hunt you. You only know what your
own light has touched or what a sonar pulse has revealed, so a dive is as much
about sensing where the danger is as outswimming it. Your light travels straight
and shows only what is around you; sound bends around corners, so a pulse scouts
ahead and finds hunters past the bend. But pinging is loud, and something out
there is listening.

Three predators hunt you, each keyed to a different signal you give off. The
Lanternjaw tracks your light, and eating plankton makes you glow brighter, so the
faster you feed the more you light yourself up for it. Its always-visible amber
bulb drifts just like the harmless bonus drifter, at the same slow pace, so you
can never be sure which glimmer in the dark is bait and which is jaws until it
lunges. The Gloamfin hunts your sound: any sonar pulse, yours or its own, hands
it a fix, and it chases a touch faster than you can swim before casting about and
re-pinging after a moment's delay, so you slip it in that window and at every
corner it turns. The Flarefish hunts your light exactly like the Lanternjaw but
gives off no sign of itself between the flares it casts, and a flare locks on
through rock if its bloom catches you.

You carry no weapon and cannot turn the hunt around. Your only tools are ink to
blind the two predators that see, and your wits to read the dark. Fathom is
inspired by classic maze-chase arcade games but is entirely its own, with an
original name, look, sensing systems, and predators. It deliberately drops the
genre's power pellets and predator-eating for pure sensory evasion.

## The two dives

Both dives are the same maze and the same three hunters, and they differ only in
the sensing model, which is the case's signature system.

- **Base** — the Standard dive. A remembered fog of war: everything your light or
  a pulse has touched stays drawn, dim, across the whole grid, and the amber
  lights carry at any distance.
- **Kindle** — the same fog of war, seen through an outer circular window you
  carry that grows as you eat. The window reveals nothing; beyond it even
  explored ground goes dark, though it is remembered and drawn again when you
  return.

## Why it is a benchmark

Fathom is a large build for an easy case, and its size is in breadth rather than
in any one hard problem: a maze generator held to structural rules, a per-tile
fog of war with three visibility states, a line-of-sight light pocket, a
wavefront that floods corridors rather than expanding as a circle, three predator
minds with distinct senses and counters, a staggered den schedule, seven screens,
and a HUD. Every one of those is stated exactly and checked exactly, so a build
that is nearly right in many places is told apart from one that is right.

## What a model is given

A run receives the self-contained specification, the seeded art the game draws
its creatures and tiles from, and a configured TypeScript project to build
inside: the Vite, Vitest, ESLint, and Prettier toolchain, and the page with its
canvas. How much more it receives depends on the engine the run selects. On an
engine run the project also carries the runtime and the case-owned modules that
name every figure the specification fixes and stand the engine up, and the run
writes the game and its debug surface against them. On an engineless run the
project carries no source at all, and the run writes the runtime as well as the
game.

The specification fixes the maze rules, the sensing model, the predator
behaviors, the scoring and the screens exactly. The art is supplied, and the
palette, the glow, the HUD layout and everything else about the look are left to
the build. Every review point is decided by a validator derived from those rules,
and the reviewer's judgement goes into the per-domain ratings of visuals, polish
and feel.
