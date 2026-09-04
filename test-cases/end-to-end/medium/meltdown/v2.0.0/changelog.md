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
the frame loop, the canvas fit, the pointer in logical stage units, keyboard
input as named actions, audio as named cues and the debug overlay; Structured 2D
also owns rendering and the framework the game is written inside, so the game
there is a game definition, a mode, actors, components and a controller. What
stays the build's is Meltdown itself: the floor, the maze, the heat model, the
towers, the surge and everything drawn.

Under `none` the workspace is that toolchain and nothing else: configuration,
`index.html`, and no `src/` at all. The model writes every line of what runs,
from the frame loop and its delta time up to the game.

Because all three projects deliver the same game, the review items, the domains
and the checks that decide them are the same across engines, and a score recorded
under one engine is comparable with a score recorded under another. The specs
branch on `engine.slug` and never on the variant, and the three validator suites
differ only in how they stand a build up. The one `base` variant ships a
reference implementation per engine, under `references/<engine>/`, and the case's
Reference tab offers a switch between them.

## The produced code is type-checked, linted, formatted and tested

`v1.0.0` declared no toolchain at all. `npm ci` and `npm run build` were the
whole of what ran over a produced tree, so a build that compiled loosely, lint
errors and all, or that shipped no tests of its own, arrived for review looking
exactly like one that did neither. A `[toolchain]` table now declares four
commands run over the produced repository once its dependencies are installed:
`npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .` and
`npx vitest run --coverage`. They run against the code the model wrote, and their
results are carried on the run. `specs/overview.md` names the same four, so the
build knows what it is held to, and it asks for unit tests beside the sources as
`src/**/*.test.ts` covering the simulation, which `v1.0.0` asked for nowhere.

The build output is pinned with them. `v1.0.0` accepted `dist/`, `build/` or
`out/` at the project root; `v2.0.0` accepts `dist/` alone, because the seeded
project's own `npm run build` already produces it and there is nothing left for a
build to choose.

## There is no fixed timestep

`v1.0.0` mandated a 60 Hz fixed timestep and advanced the debug surface in whole
ticks, so the case asked for a game clocked at a rate the harness fixed. Both are
gone, and the manifest carries no `tick_hz`. Every rate in Meltdown is per second
and is integrated against the delta time the frame hands it: the surge's speed,
every fire clock, every thermal flow, the build-phase countdown, the trip
cooldown, the slow timer and the wave spawner's cadence. The thermal model
resolves from the heats a frame opened on rather than from a tick boundary, the
clock operations take seconds, and each validator constructs its own clock and
asks for exactly the frames its measurement wants.

## Whether time passes is measured on the clock the game runs on

`v1.0.0`'s pause check paused the game and then stepped it, which measures where
a build puts its pause gate rather than whether the floor freezes. A build
holding the pause in the shell that drives the clock is equally legal, and it
stepped straight through the check while its real-time clip showed the surge
stopping dead, so the verdict contradicted its own evidence. Worse in the other
direction: a build whose pause menu opens over a floor that keeps running, the
defect the item exists to catch, passed outright whenever the step happened to be
gated.

That fix is now a rule the whole case is built to: an item about whether time
passes is measured on the clock the player's game actually runs on, never through
the stepping operation, because the stepping operation is instrumentation and the
question is about the game. Which clock that is differs by engine, and the rule
is the same either way. Under `none` the clock operations belong to the surface
the build wrote and can be gated apart from its own frame loop, so such an item
hands the clock back with `setAutoStep(true)`, spends the window in real time,
and never calls `advance`. Under either engine `engine.advance` is the engine's
own frame loop with a clock of the suite's own, running the identical frame a
player's frame runs, so it is the player's clock and the item advances through
it.

The window is two legs of equal length on whichever clock that is. A running leg
the floor must really travel in comes first, then a paused leg whose positional
drift and simulated-clock gain must both stay under a ceiling, with both readings
taken from the one snapshot on the press so the pair spans the paused window and
nothing else. The running leg is what stops a dead floor passing vacuously, and
the tolerances are non-zero on purpose because the pause and the position are
read a round trip apart. Five items carry it: the two pause items, the resume,
the game running on its own clock, and the speed toggle.

## Every review item is decided by a validator

The checklist grew from `107` items to `375`, and the twenty-nine categories that
held them became nineteen. Every one of the `375` names a Vitest suite under
`validation/<engine>/`, the domains its failure lowers, and how far it lowers
them. The `100` standalone `.mjs` browser drivers of `v1.0.0`, and the single
module they shared, are gone, and so are the seven items it left for a reviewer
to decide from a screenshot alone.

Under `none` a suite drives the built site in headless Chromium through
`window.__meltdown`; under either engine the same scenario runs in process
against the vendored engine, standing it up over a canvas and a clock of its own
and reaching the surface through `engine.debug`. Each project carries the same
spec-derived oracle beside its harness: one module recomputes the two-phase heat
model from the specification's own figures, and another recomputes the route
metric the same way, so every thermal and pathing expectation is derived from a
rule the specs state rather than from a number the reference produced.

The reference mockups, the `[[proof]]` captures and `specs/proof.md` are gone
with the scripts. Every piece of media a reviewer looks at is now produced by the
case's own validators, from scenarios the case controls, and the same suites run
against each engine's reference build to produce the baseline the run's media is
shown beside.

## Four domains instead of two

`v1.0.0` rated a run on `heat` and `defense`, so the whole frame around a
match — the run, the economy, the modes, the screens, the panel and the
audio — landed in the tower-defense domain or nowhere. A run is now rated on
`heat`, `defense`, `run` and `presentation` independently, and its overall
functional rating is the worst of the four, so a build whose thermal model is
exact and whose screens do not navigate is told apart from one where it is the
other way round.

## The debug surface poses one field at a time

No operation survives from `v1.0.0` with its old signature. `placeTower`,
`startGame` and the old `setWave` were compound: one call armed, rotated, moved
and placed; another opened a whole run; another rebuilt the run at a wave. No
scenario could be posed without asserting several outcomes on the way to it. The
surface is now atoms. Each operation sets one field, reads the state or moves the
clock, and the snapshot reports every field an operation can set, so every pose
is verifiable by set-then-read.

Beside the atoms sit four gates that were missing entirely. `setWaveSpawning`
holds the run's own release of surge, so a posed thermal scenario is not invaded
a second later by a wave the build's timer started. `setTowerFiring` and
`setTowerThermal` split a tower's guns from its heat model, so a thermal figure
is never measured against a tower that is also shooting and a damage figure is
never measured against a heat that is drifting. `setUnitMotion` holds a unit
still, so range, splash and slow are read with nothing walking out of frame. And
`clearTowers`, `clearSurge`, `removeTower` and `removeUnit` mean a validator can
empty a floor without paying a refund, costing a life or paying a bounty.
`canPlace` is gone: a check that wants to know whether a placement is legal arms
the tower, poses the preview and reads the snapshot's `build.valid`, which is the
value the player's own press is decided by.

`setScreen` and `setPhase` are poses in the same sense: each sets its field and
runs no entry effect. It matters because a screen or phase entry is where
Meltdown pays its interest and its wave-clear bonus, scores that clear, ends a
tower's freshness, focuses PLAY AGAIN on an end screen and raises the wave-clear,
victory and game-over cues. An operation that fired those on the way in would
assert the very outcome an item exists to decide, which is exactly what
`v1.0.0`'s `startGame` and `setWave` did on the way to a wave's build phase.
Thirteen items whose requirement is an entry effect therefore reach the
transition the way the game reaches it — a wave clearing, a send, a build timer
running out, lives running out, a final wave cleared — rather than by posing the
destination.

Where a player's act genuinely has several consequences, the act stays whole:
`place`, `upgradeTower` and `sellTower` run through the game's own code, and each
consequence is its own review item.

## The specifications were rewritten

Every spec was rewritten against the current authoring guidelines, and the file
set changed with them. Twelve files became eighteen, and each rule now lives in
exactly one of them. `specs/playfield.md` split into `specs/floor.md`, which owns
the geometry and the tile-to-stage map, and `specs/mazing.md`, which owns towers
as walls and how the surge crosses them. `specs/towers.md` split into the roster,
`specs/combat.md` for what an emitter does to a unit, and `specs/building.md` for
what a player does to a tower. `specs/gameplay.md` split into `specs/waves.md`
and the simulation rules that moved into `specs/heat.md`. `specs/ui.md` split
into `specs/hud.md`, `specs/screens.md` and `specs/audio.md`. `specs/state.md`
and `specs/showcase.md` are new, and `specs/proof.md` is gone.

The prose states what the finished build must be and do, and nothing about how to
build it. Behavior a check reads is stated exactly or between explicit bounds,
and the file that owns a rule is the only file that states it: `specs/floor.md`
alone carries the tile-to-stage map, and `specs/combat.md` alone carries the slow
rule that `specs/surge.md` used to share.

## Seven rules the specification left open are pinned

Seven rules `v1.0.0` left to each build to invent, or left contradicting
themselves, could not be checked as they stood. Each is now stated exactly, and
every value chosen sits inside what `v1.0.0` described.

The wave composition, size and cadence are closed forms with a seeded per-unit
vent draw, where `v1.0.0` said the per-wave count, spawn timing and vent split
were the build's to design. The Hundred's flat HP factor and its hundred-unit
composition are stated. Bottleneck's "marked central zone" is stated as exact
columns and rows. The order heat flows resolve in within a frame is stated as a
two-phase rule, which every thermal figure in the case is now measured against.

Two of the seven were predicates a build could read two ways. The trip is stated
as a crossing rather than a state, so an emitter trips on the frame in which its
newly resolved heat reaches `100` having opened that frame below it, and a tower
already at `100` when a frame opens and falling during it does not trip. A menu
highlight wraps at both ends, on every menu.

The seventh was a contradiction. `specs/towers.md` said the Rime "does not deal
meaningful damage" while the tower table gave it a base damage of `4` and the
reference applied the heat multiplier to it like any other emitter's, so the
specification and the build it shipped disagreed about what a Rime's shot does.
The Rime is now an ordinary emitter: base damage `4`, redline `100`, and a shot
that removes `4 * heatMultiplier(H, 100)` exactly as every other emitter's does.
Its slow is an addition to that damage rather than a replacement for it, and the
inspector showing a slow read where an emitter shows a damage read is a display
rule and nothing more.

## The look is the build's

`v1.0.0` fixed a 27-entry palette, a monospace typeface, hex values restated
across five more spec files, and a set of rendered mockups a build was shown as
reference views. All of it is gone. What the specification now fixes about
appearance is a legibility table of what a player must be able to read: an
emitter's color tracking its heat along a ramp, a tripped tower apart from an
online one at the same heat, radiator faces apart from plain ones, a valid
preview apart from an invalid one, and the surge apart from every color a tower
shows anywhere on its ramp. The `presentation` items assert that a thing is drawn
and that two things are told apart, against a stated RGB distance and never a hex
value. The palette, the type, the glow and every other aspect of the look are the
build's own design, and how good it looks is rated by a reviewer rather than
scored here.

## The build ships a showcase

`specs/proof.md` and the proof captures are gone. In their place the build ships
`showcase/` beside its source: a player-facing description and a short ordered
carousel of captured media, framed as the game's store-page presentation rather
than as evidence any item is judged on. The case ships one of its own for the
`base` variant, captured from the `structured-2d` reference under scripted input, so
what the catalog shows is the game's own rules playing out rather than an outcome
posed through the debug surface.
