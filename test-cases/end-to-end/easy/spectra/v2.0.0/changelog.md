## Spectra is a TypeScript project, on one of three engines

This version stops asking a model for a self-contained page built on top of a
bare `package.json` and asks it for a real project instead. A run is seeded with a
complete TypeScript workspace — Vite, `tsc`, ESLint, Prettier and Vitest already
configured, an `index.html` holding the canvas, and the sprite art and the
drone-burst system under `assets/`. How much of that project the model writes is
what the engine decides.

Under [Simple 2D](/engines/simple-2d/) and
[Structured 2D](/engines/structured-2d/) the workspace also carries the
case-owned modules around the game, `src/constants.ts` and `src/main.ts`, and the
model writes `src/game.ts` against them. Everything the specification fixes as a
number, a key binding, a cue name or a piece of screen copy has a name in
`src/constants.ts`, and the specs cite those names rather than restating the
figures. The engine owns the frame loop, the canvas fit, keyboard input as named
actions, audio as named cues, asset loading and the debug overlay; Structured 2D
also owns rendering and the framework the game is written inside. What stays the
build's is Spectra itself: the bands, the swarm, the discharge and everything
drawn.

Under `none` the workspace is that toolchain and nothing else: ten files at the
root, and no `src/` at all. The model writes every line of what runs, from the
frame loop and its delta time up to the game.

## Three engines, one game

Because all three projects deliver the same game, the review items, the domains
and the validators that decide them are the same across engines, and a score
recorded under one engine is comparable with a score recorded under another. Each
variant ships a reference implementation per engine, under
`references/<engine>/<variant>/`, and the case's Reference tab offers a switch
between them.

## No palette, no typeface, and no reference mockups

`v1.0.0` wrote an eleven-entry canonical palette and a monospace type requirement
into `specs/overview.md`, and seeded reference mockup screenshots a build was
compared against. All three are gone. Appearance is loose and reviewed: the case
seeds the art, and `specs/overview.md` states a **legibility table** — what a
player must be able to read at a glance — instead of the values behind those
readings.

Spectra is the case where that needs care, because the seeded art already carries
the two band colours. So the specification fixes the _relationship_ rather than
the value: everything the build draws in a band uses the same two colours the art
does, each band carries a distinct shape accent, and no hex value appears anywhere
in the seeded set. The `presentation` validators assert presence and
distinguishability against a stated RGB distance, never a colour.

## No mandated fixed timestep

`v1.0.0` clocked the simulation at 120 Hz and declared `tick_hz` accordingly.
`v2.0.0` declares none. Every rate in the specification is per second and
integrated against the delta time the frame hands the game. What replaces the
tick is a **sub-step ceiling**: a frame is divided into
`n = max(1, ceil(dt / SUBSTEP_MAX))` sub-steps of `h = dt / n`, and
`specs/simulation.md` states the order each sub-step resolves in, so one second of
game time covers the same ground whether it arrived as one frame or a hundred and
twenty.

## A Flux's window is a stage formula, not a flat figure

`v1.0.0` carried a flat `4.0` second Flux cycle, which is the stage-1 value and
nothing else: the hold falls from `1.6` toward a floor of `1.0` as the stages
climb, so the true cycle reaches `2.8`. `fluxWindow(stage)` and `fluxCycle(stage)`
are now stage formulas alongside `droneSpeedScale`, `bulletSpeedScale`,
`diveGapScale` and `fluxHold`, and every rule that advances a Flux through a
window names the stage it means.

## The debug surface is rewritten

No operation survives with its `v1.0.0` signature. The surface now poses one field
at a time, reads every pose back through the snapshot, and carries three **world
gates** (`setWaveEntry`, `setDiveLaunching`, `setShipContact`) and three per-drone
**faculty switches** (`setDroneTravel`, `setDroneOscillation`, `setDroneFire`), so
a scenario holds only what its requirement concerns and nothing it did not ask for
arrives, launches, or costs a life. The wave's dive clock is declared state, which
is what makes a dive-timing scenario well defined against a build that starts its
delay at the assembly transition.

## The produced code is type-checked, linted, formatted and tested

A `[toolchain]` table declares four commands run over the produced tree once it is
installed: `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .`, and
`npx vitest run --coverage`. They run against the code the model wrote, and their
results are carried on the run. `specs/overview.md` names the same four, so the
build knows what it is held to.

## Every review point is decided by a validator

The checklist is now 264 points on a base run and 282 on an overload run, across
sixteen categories, and each one is one observable behaviour decided by its own
vitest suite under `validation/<engine>/<category>/<item>.test.ts` — never by a
reviewer's reading. Each point names the scoring domains its failure lowers and
how far, so the functional rating for each of the four domains is computed rather
than given, and the reviewer's judgement lives in the separate aesthetic rating.

Splitting the checklist this way fixed eight defects `v1.0.0` earned by being run:
a wave is now cleared by clearing the game's own wave rather than by posing into a
debug-cleared field, the stage-cleared screen is reached the same way, a key and
the effect it triggers are graded separately, a wrapping dive is read as correct
rather than as a discontinuity, a Prism's escort is read across the whole entrance
rather than at one instant, a challenge group is read as what a player sees rather
than as what a frame lists, mute is stated at source strength in the specification
rather than asserted weakly, and an item whose claim is a difference captures both
states.

## The build ships a showcase, and no proof captures

`specs/proof.md` and the five `[[proof]]` entries are gone. The build is asked
instead for a `showcase/` at its project root — its own store-page presentation of
the game — and every piece of media a reviewer sees beside a verdict is captured
by this case's own validator suites, from scenarios the case controls.
