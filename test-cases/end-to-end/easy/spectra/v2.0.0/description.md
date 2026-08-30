## Overview

**Spectra** is a fixed-position formation shooter for the browser. You pilot a
lone resonator-fighter along a lane at the bottom of a starfield while a swarm of
crystalline drones flies in on sweeping paths, assembles into a slowly swaying
formation overhead, then peels off one at a time to dive at you. You clear a
stage by destroying every drone of its wave.

Its defining idea is polarity. Your cannon is tuned to one of two spectral bands,
cyan or magenta, and you flip between them at will. A shot only destroys a drone
of the matching band, and the band you hold is also your shield: enemy fire of
your own band is absorbed harmlessly, and fire of the other band is lethal.
Because a formation always holds both bands at once, the drone you want to shoot
and the bullets you must survive pull your choice in opposite directions, and the
flip that saves you costs a held beat of fire. Absorbing fire and landing matched
kills fills a resonance meter, and a full meter buys a discharge that wipes every
diver in the air while leaving the formation untouched.

Three drones press that one idea three different ways. A Shard holds a single
band. A Flux oscillates between the two on a telegraphed rhythm you have to catch
on the beat. A Prism wears both bands at once as a shell over a core, arrives
escorted, and inverts the bands of the entire field if you let it reach the
bottom. Every third stage breaks the pattern with a challenge flyover: forty
drones sweep the field in single-band groups, fire nothing, cost nothing, and pay
a bonus for a clean sweep.

Spectra is inspired by classic formation-shooter arcade games but is entirely its
own, with an original name, look, dual-use polarity system, resonance discharge
and drones. It deliberately drops the genre's captured-ship rescue and double
fighter, because survival here is about reading the field's two bands and
flipping at the right instant rather than about power-ups.

## Why it is a benchmark

Spectra is a large build for an easy case, and its size is in breadth rather than
in any one hard problem. There is no physics beyond straight-line integration, no
opponent to model, and nothing that has to be tuned by feel: every rule is stated
over one `1280 x 720` stage. What it asks for is a lot of exact rules holding at
once.

- An effective-band definition composed from two independent swaps — a Flux's own
  oscillation and a field-wide spectral inversion — that every shot, every
  absorb and every kill is decided through.
- Three drone kinds that each probe that definition a different way, including a
  two-layer Prism broken shell-then-core and an escort that enters beside it.
- A wave that flies in as staggered groups on sweeping paths, assembles into
  slots, sways as one rigid body, and launches dives off a clock of its own.
- A resonance meter with exactly two sources, a cap, no decay, and a discharge
  that takes divers and enemy fire while sparing the formation.
- A stage ladder with four scaling formulas, each with its own cap or floor, and
  a challenge flyover every third stage that scales with none of them.
- Three lives, a respawn, an extra life paid once, seven screens, a HUD and nine
  audio cues.

Every one of those is stated exactly and checked exactly, so a build that is
nearly right in many places is told apart from one that is right.

## The two modes

A run is asked for one of two modes, and they disagree about exactly one rule:
what a mismatched shot does to the drone it hits. Under **Sortie** it does
nothing, and the shot is simply wasted. Under **Overload** it charges the drone,
and the third charge overloads it into a reaction that differs by kind — a Shard
plunges, a Flux flips its band and sprays, a Prism bursts in both bands and may
grow the swarm. That one rule inverts the risk of a wrong-band shot, so the same
field is played very differently under each.

## What a model is given

A run receives the self-contained specification, the seeded sprite art and the
seeded drone-burst particle system the game pops a destroyed drone with, and a
configured TypeScript project to build inside: the Vite, Vitest, ESLint and
Prettier toolchain, and the page with its canvas. How much more it receives
depends on the engine the run selects. On an engine run the project also carries
the runtime and the case-owned modules that name every figure the specification
fixes and stand the engine up, and the run writes the game and its debug surface
against them. On an engineless run the project carries no source at all, and the
run writes the runtime as well as the game.

The specification fixes the stage geometry, the band rules, the ship and its
cannon, the swarm's choreography, the three drones, the resonance discharge, the
stage ladder, the scoring and the screens exactly. The art is supplied, and the
palette, the type, the glow, the HUD layout and everything else about the look are
left to the build. Every review point is decided by a validator derived from those
rules, and the reviewer's judgement goes into the per-domain ratings of visuals,
polish and feel.
