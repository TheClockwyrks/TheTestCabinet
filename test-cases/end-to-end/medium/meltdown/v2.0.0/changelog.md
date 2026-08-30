## Meltdown is a TypeScript project, on one of three engines

This version stops asking a model for a single-workspace build on a bare
`package.json` and asks it for a real project instead. A run is seeded with a
complete TypeScript workspace, with Vite, `tsc`, ESLint, Prettier and Vitest
already configured and an `index.html` holding the canvas. How much of that
project the model writes is what the engine decides.

Under [Simple 2D](/engines/simple-2d/) and [Structured
2D](/engines/structured-2d/) the workspace also carries the case-owned modules
around the game, `src/constants.ts` and `src/main.ts`, and the model writes
`src/game.ts` against them. Everything the specification fixes as a number, a key
binding, a cue name or a piece of screen copy has a name in `src/constants.ts`,
and the specs cite those names rather than restating the figures. The engine owns
the frame loop, the canvas fit, keyboard input as named actions, audio as named
cues and the debug overlay; Structured 2D also owns rendering and the framework
the game is written inside. What stays the build's is Meltdown itself: the floor,
the maze, the heat model, the towers, the surge and everything drawn.

Under `none` the workspace is that toolchain and nothing else: configuration,
`index.html`, and no `src/` at all. The model writes every line of what runs,
from the frame loop and its delta time up to the game.

Because all three projects deliver the same game, the review items, the domains
and the checks that decide them are the same across engines, and a score recorded
under one engine is comparable with a score recorded under another. The specs
branch only where the deliverable differs.

## There is no fixed timestep

`v1.0.0` mandated a 60 Hz fixed timestep and advanced the debug surface in whole
ticks. Both are gone. Every rate in Meltdown is per second and is integrated
against the delta time the frame hands it, the thermal model resolves from the
heats a frame opened on rather than from a tick boundary, and the clock
operations take seconds. The manifest carries no `tick_hz`.

## Every review item is decided by a validator

The checklist is entirely validator-rated: 343 items across eighteen categories,
each carrying a vitest suite under `validation/<engine>/`, the domains its
failure lowers, and how far it lowers them. Nothing is left to a reviewer to
decide from a screenshot. Every thermal expectation is computed from the
specification's own figures and every route expectation from its own metric, so
no threshold on the checklist is a number the reference produced.

## Whether time passes is measured on the clock the game runs on

`v1.0.0`'s pause check paused the game and then stepped it, which measures where
a build puts its pause gate rather than whether the floor freezes: a build
holding the pause in the shell that drives the clock stepped straight through the
check while its clip showed the surge stopping dead, and — worse — a build whose
pause menu opens over a floor that keeps running passed outright whenever the
step happened to be gated.

That fix is now a rule the whole case is built to. Any item about whether time
passes settles over a real window on the build's own clock, in two legs of equal
length, and never calls the stepping operation: a running leg the floor must
really travel in, and a paused leg whose drift and simulated-clock gain must both
stay under a ceiling, with both readings taken from the one snapshot on the press
so the pair spans the paused window and nothing else. The running leg is what
stops a dead floor passing vacuously. Five items carry it: the two pause items,
the resume, the game running on its own clock, and the speed toggle.

## The debug surface poses one field at a time

No operation survives from `v1.0.0` with its old signature. `placeTower`,
`startGame` and the old `setWave` were compound — one call arming, rotating,
moving and placing, or opening a whole run, or rebuilding the run at a wave — so
no scenario could be posed without asserting several outcomes on the way to it.
The surface is now atoms: each operation sets one field, reads the state or moves
the clock, and the snapshot reports every field an operation can set.

Beside the atoms sit four gates that were missing entirely. `setWaveSpawning`
holds the run's own release of surge, so a posed thermal scenario is not invaded
a second later by a wave the build timer started. `setTowerFiring` and
`setTowerThermal` split a tower's guns from its heat model, so a thermal figure
is never measured against a tower that is also shooting and a damage figure is
never measured against a heat that is drifting. `setUnitMotion` holds a unit
still, so range, splash and slow are read with nothing walking out of frame. And
`clearTowers`, `clearSurge`, `removeTower` and `removeUnit` mean a validator can
empty a floor without paying a refund, costing a life or paying a bounty.

Where a player's act genuinely has several consequences, the act stays whole:
`place`, `upgradeTower` and `sellTower` run through the game's own code, and each
consequence is its own review item.

## Seven rules the specification left open are pinned

The wave composition, size and cadence are stated as closed forms with a seeded
per-unit vent draw. The Hundred's flat HP factor and its hundred-unit
composition are stated. Bottleneck's zone is stated as exact columns and rows.
The order heat flows resolve in within a frame is stated as a two-phase rule.
The trip is stated as a crossing rather than a state, so a tower already at 100
when a frame opens and falling during it does not trip. A menu highlight wraps at
both ends. And the Rime is stated as an ordinary emitter — base damage `4`,
redline `100`, and a shot that removes `4 * heatMultiplier(H, 100)` like any
other — where `v1.0.0` had its spec and its reference contradicting each other.

## The look is the build's

`v1.0.0` fixed a 27-entry palette, a monospace typeface and a set of rendered
mockups a build was compared against. All of it is gone. What the specification
now fixes about appearance is a legibility table of what a player must be able to
read: an emitter's colour tracking its heat, a tripped tower apart from an online
one at the same heat, radiator faces apart from plain ones, the surge apart from
every colour a tower shows anywhere on its ramp. The `presentation` items check
presence and distinguishability against a stated RGB distance and never a hex
value. The palette, the type, the glow and every other aspect of the look are the
build's own design.

## The build ships a showcase

`specs/proof.md` and the proof captures are gone. In their place the build ships
`showcase/` beside its source: a player-facing description and a short ordered
carousel of captured media, framed as the game's store-page presentation rather
than as evidence any item is judged on.
