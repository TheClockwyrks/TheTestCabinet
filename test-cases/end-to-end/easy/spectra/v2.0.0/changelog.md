## Spectra is a TypeScript project, on one of three engines

This version stops asking a model for a self-contained page built on top of a
bare `package.json` and asks it for a real project instead. A run is seeded with a
complete TypeScript workspace, with Vite, `tsc`, ESLint, Prettier and Vitest
already configured, an `index.html` holding the canvas, and the sprite art and the
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
also owns rendering and the framework the game is written inside, so the game
there is a game definition, a mode, actors, components and a controller. What
stays the build's is Spectra itself: the bands, the ship, the swarm, the
discharge and everything drawn.

Under `none` the seeded project adds no source at all: ten configuration and
page files at its root, and no `src/` directory. The model writes every line of
what runs, from the frame loop and its delta time up to the game.

## Three engines, one game

Because all three projects deliver the same game, the review items, the domains
and the validators that decide them are the same across engines, and a score
recorded under one engine is comparable with a score recorded under another. The
specs branch on `engine.slug` where the deliverable differs and on
`variant.slug` only for the mode, and the three validator projects differ only in
how they stand a build up. Each variant ships a reference implementation per
engine, under `references/<engine>/<variant>/`, and the case's Reference tab
offers a switch between them.

## The specifications were rewritten

Every spec was rewritten against the current authoring guidelines, and the file
set changed with them. `v1.0.0` shipped ten files, four of which each held
several concerns at once: `specs/controls.md` carried the simulation core, the
ship's movement, the key bindings, firing and the discharge control;
`specs/gameplay.md.hbs` carried the mode, the stages, the challenge flyover, the
scoring and the lives; `specs/polarity.md` carried the bands and the resonance
discharge together; and `specs/drones.md` carried everything true of any drone
alongside the three kinds. `v2.0.0` ships eighteen files, one concern each, and
every rule lives in exactly one of them.

`specs/playfield.md` becomes `specs/field.md` and keeps the geometry alone,
taking sole ownership of the ship's lane and the formation slot grid.
`specs/controls.md.hbs` keeps the keys alone: its simulation core becomes
`specs/simulation.md`, and its movement and its firing join the ship's footprint
in `specs/ship.md`. `specs/gameplay.md.hbs` splits into `specs/stages.md`,
`specs/progression.md`, `specs/scoring.md` and `specs/mode.md.hbs`, the last of
which is the only file that states the rule the two modes disagree about.
`specs/polarity.md` splits into `specs/bands.md` and `specs/resonance.md`.
`specs/drones.md` sheds everything true of any drone into a new `specs/swarm.md`
and keeps the three kinds. `specs/state.md.hbs` and `specs/showcase.md.hbs` are
new, and `specs/proof.md` is gone.

The prose states what the finished build must be and do, and nothing about how to
build it. Behavior a check reads is stated exactly or between explicit bounds.

## No palette, no typeface, and no reference mockups

`v1.0.0` wrote an eleven-entry canonical palette and a monospace type requirement
into `specs/overview.md`, and seeded reference mockup screenshots of the title,
gameplay and game-over screens. All three are gone. Appearance is loose and
reviewed: the case seeds the art, and `specs/overview.md` states a legibility
table — what a player must be able to read at a glance — instead of the values
behind those readings.

Spectra is the case where that needs care, because the seeded art already carries
the two band colors. The specification therefore fixes the relationship rather
than the value: everything the build draws in a band uses the same two colors the
art does, and each band carries a distinct shape accent so the bands stay legible
to a colorblind player. No spec file names a color value, and the only hex in the
seeded set is the black the page and the placeholder `BACKGROUND` start at. The
presentation validators assert that a thing is drawn and that two things are told
apart, against a stated RGB distance, never a color.

## No mandated fixed timestep, and a frame is sub-stepped

`v1.0.0` declared `tick_hz = 120`, so the case asked for a game clocked at a rate
the harness fixed. `v2.0.0` declares none. Every rate in the specification is per
second and integrated against the delta time the frame hands the game, and each
validator constructs its own clock and asks for exactly the frames it wants.

What replaces the tick is a sub-step ceiling. A frame is divided into
`n = max(1, ceil(dt / SUBSTEP_MAX))` sub-steps of `h = dt / n`, and
`specs/simulation.md` states the order each sub-step resolves in, so one second of
game time covers the same ground whether it arrived as one frame or as a hundred
and twenty. That is a rule about how a frame is subdivided rather than a rate
anything samples at, which is why the manifest's `tick_hz` stays absent.

## A Flux's window is a stage formula, not a flat figure

`v1.0.0` carried a flat `4.0` second Flux cycle, which is the stage-1 value and
nothing else: the hold falls from `1.6` toward a floor of `1.0` as the stages
climb, so the true cycle reaches `2.8`. A check written against the flat figure
claimed to measure the oscillation and in fact measured it only at stage 1.

The hold is now `fluxHold(stage)`, one of the four stage formulas
`specs/stages.md` states alongside `droneSpeedScale`, `bulletSpeedScale` and
`diveGapScale`, each with its own cap or floor. `fluxWindow(stage)` and
`fluxCycle(stage)` are built on it, and every rule that advances a Flux through a
window names the stage it means.

## The debug surface poses one field at a time

The `v1.0.0` surface could not pose a scenario. `spawnDrone(spec)` took a nine-key
patch and `spawnPlayerBullet`/`spawnEnemyBullet` took patches of their own, so the
case imposed its own entity layout on the build rather than setting a field.
`startGame()` and `startStage(stage)` each arranged several things at once, so
what a scenario had actually posed was never one thing. `flip()` and `discharge()`
named outcomes that other items were supposed to grade. `clearField()` emptied the
drones and both bullet rosters together, with no `removeDrone(id)` beside it, so a
check wanting one drone and one enemy bullet had to clear everything and rebuild.
`setDroneAI(enabled)` was a single whole-swarm switch that halted sway, path
advance, dive decisions and firing at once. And `snapshot()` reported
`menuIndex`, `inversionActive` and `muted` with nothing on the surface able to
produce any of them, while bullets and bursts carried no `id` at all.

Every operation is now atomic, takes scalars, and is verifiable by set-then-read:
each one sets one field, reads the state, or moves the clock, and `snapshot()`
reports every field an operation can set. A drone is placed with
`addDrone(kind, x, y)` and then given its band, its phase, its slot, its band
clock and its shell one call each. `dischargeReady` and `isChallenge` are derived
reads that follow `setResonance` and `setStage`; `inversionActive` follows
`setInversion(seconds)`; `menuIndex` gets `setMenuIndex(n)`. Every drone, bullet
and burst carries an `id`, and an entity added through the surface is appended to
its roster.

There is deliberately no `setMuted`. Mute is reached the way a player reaches it,
through the `KeyM` binding, and `muted` is a live read of the runtime's own mute
bit at the call rather than a shadow field a pose could write.

## Every scenario poses a world holding only what it is about

Emptying the rosters is not enough on its own, because three faculties belong to
the world rather than to any entity in it and walk into a scenario that never
asked for them: the wave's own entry schedule, the launcher that peels a diver off
the formation, and the ship's contact test. A posed field is maximally sparse, so
a wave arriving mid-check or a dive launching on its own clock changes the very
rosters the check is reading, and the ship is the one entity a scenario cannot
remove, so a diver reaching the lane would cost a life mid-check.

Each of those is now a gate of its own — `setWaveEntry`, `setDiveLaunching` and
`setShipContact` — each gating one faculty and nothing else, defaulting to on,
restored to on by `reset`, and reported by `snapshot()` so it is verifiable by
set-then-read. Drones carry the same treatment per faculty: `setDroneTravel`,
`setDroneOscillation` and `setDroneFire` hold a drone's locomotion, its band clock
and its cannon apart, so a check on what a Flux's band does over time poses it
stationary and a check on how it flies poses it holding a band, and neither can be
disturbed by the other. The wave's dive clock is declared state, which is what
makes a dive-timing scenario well defined against a build that starts its delay at
the assembly transition. Nothing is contained instead of removed: a bystander is
deleted rather than parked in a quiet corner, because parking it leans on the very
rules a broken build breaks.

## The produced code is type-checked, linted, formatted and tested

A `[toolchain]` table declares four commands run over the produced tree once it is
installed: `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .`, and
`npx vitest run --coverage`. They run against the code the model wrote, and their
results are carried on the run. `specs/overview.md` names the same four, so the
build knows what it is held to.

## Every review point is decided by a validator

`v1.0.0` graded `80` points on a base run and `84` on an overload run, of which
`73` and `77` carried a standalone browser script; the rest were left to a
reviewer to decide by looking. The checklist is now `282` points on a base run and
`300` on an overload run, across nineteen categories, and every single one of them
is one observable behavior decided by its own Vitest suite under
`validation/<engine>/<category>/<item>.test.ts`. Under `none` a suite drives the
built site in headless Chromium through `window.__spectra`, with a page-injected
2D-context recorder for the draws and an injected audio shim for the cues; under
either engine the same scenario runs in process against the vendored engine,
standing it up over a canvas and a clock of its own and reaching the surface
through `engine.debug`.

## Four domains instead of two

`v1.0.0` rated a run on `polarity` and `swarm`, so the ship, the stages, the
scoring, the screens and the audio had no domain of their own and rode on one of
those two. A run is now rated on `polarity`, `swarm`, `arcade` and `presentation`
independently, and its overall functional rating is the worst of the four, so a
build whose band rules are exact and whose screens are threadbare is told apart
from one where it is the other way round.

## The eight lessons v1.0.0 learned by being run

Running `v1.0.0` turned up eight checks that measured something other than what
they claimed to measure, and each was patched in a `v1.0.0` validator. `v2.0.0`
replaces every validator in the case, so each lesson had to be earned again
through a different mechanism. Several are now held up by a rule the
specification states outright rather than by a validator being careful about how
it reads the field, which is the better place for them: a build is told what it
is held to. The eight sections below are those lessons and where each one landed.

## A stage is cleared by clearing the game's own wave

As first written, `stages.advance` posed a drone into a field that `clearField()`
had just emptied and then destroyed it. It claimed to measure that clearing a
wave advances the stage, and in fact measured whether a debug clear leaves the
wave live — an unwritten side effect no build was told about. A build whose
progression was correct in play failed it.

Two items now carry it, and a stated rule holds them up. `specs/stages.md` now
states the level-clear rule as a moment: a stage clears in the moment the last
drone of its wave is destroyed, so a wave that never held a drone is playing
rather than cleared. `stages.clears-on-last-drone` lets the real stage-1 wave fly
in, rakes it down to its last drone and shoots that drone, so the wave under test
is the game's own. `stages.empty-wave-does-not-clear` asserts the other half
directly, which is what makes an empty posed field safe for the other `266` common
items.

## The stage-cleared screen is reached the same way

The same posing bug had captured a blank screen for `ui.state-stage-cleared`:
the screen it photographed was the one a debug-emptied field produced, not the
one a player reaches. `stages.stage-cleared-screen` now reads the screen after
`stages.clears-on-last-drone`'s drive, so the capture is of the screen a cleared
wave actually opens.

## One behavior is graded once

As first written, `controls.discharge-key` asserted both that the key started a
discharge and that the meter was spent. It claimed to measure the binding and
measured the meter as well, so a build whose key was wired correctly and whose
meter was wrong lost a `controls` point for a resonance fault.

`v1.0.0` split the two claims into two items, and `v2.0.0` keeps them apart:
`controls.discharge-x` asserts only that the key starts the real discharge wave,
and `resonance.discharge-spends` only that the meter drops to zero. The split is
now a rule over the whole checklist rather than one item's repair: an item asserts
its own requirement and nothing else, which is why the checklist more than tripled
without the game gaining a rule.

## A wrapping dive is correct, not a fault

As first written, `swarm.dive-returns` sampled a diver's path and read the
bottom-to-top wrap as a discontinuity, and read a build that never reports the
`returning` phase as one that never came home. It claimed to measure that a diver
returns to its slot and in fact measured whether the path was continuous in screen
coordinates and whether one particular phase name appeared.

`v1.0.0` taught the one item to allow the wrap. `v2.0.0` also stops it from
asserting three things at once, and `specs/swarm.md` states outright that a dive
ends either by looping back above `FIELD_BOTTOM` or by wrapping through the
bottom, so the wrap is one of two stated endings rather than something a check has
to be generous about.
`swarm.dive-continuous` allows at most one discontinuity and only as a wrap across
the field edges, with a tolerance either side because the endpoints come from two
samples a couple of frames apart. `swarm.dive-returns` asserts the re-settle
alone, `swarm.dive-speed` the rate, and `swarm.looping-dive-stays-in-field` the
other ending. A build failing one is named for that one.

## A Prism's escort is read across the whole entrance

As first written, `drones.prism-escort` counted the entering drones at one chosen
instant. It claimed to measure that a Prism arrives escorted and in fact measured
what one frame's roster happened to list, which passed a build that marks a whole
wave as entering from the first frame and failed a build that staggers its groups.

`v1.0.0` answered by sweeping the entire entrance, and `v2.0.0` reads it the same
way: two opposite-band Shards in motion and within `320` units of the Prism at the
same instant, which is the escort a player sees rather than a count taken at a
moment of the check's choosing. No stated rule fixes an escort radius, so the `320`
units are an honest tolerance on entering alongside, and the reasoning for the
figure travels with it: a quarter of the field's width is loose enough for any
entrance choreography a build invents and nowhere near loose enough to sweep in a
drone entering on the far side of the stage.

## A challenge group is what a player sees, not what a frame lists

As first written, `stages.challenge-alternating` clustered arrivals in time
alone. It claimed to measure that a challenge stage's five groups alternate bands
and in fact measured how the build happened to batch its spawns: a build sweeping
each group of eight in as two waves of four read as ten groups, and drones queued
off the left or right edge counted as arrived because their flight `y` was already
inside the field.

`v1.0.0` fixed both halves in the one item. `v2.0.0` also stops it from grading
two requirements at once: `stages.challenge-single-band-groups` asserts that no
group mixes the bands and `stages.challenge-alternates` that consecutive groups
differ. Both read arrival as inside the field on both axes, and both merge
adjacent same-band waves before comparing, so a group is the thing that flies
across the screen together.

## Mute is stated at source strength

`audio.mute-toggle` deliberately did not assert silence, because a build that
mutes by riding a gain node to zero still starts its Web Audio sources and is
inaudible to a player all the same. The item claimed to measure mute and in fact
measured only that a flag flipped. `v1.0.0` answered that by asserting less;
`v2.0.0` answers it in the specification, which is what a validator needing
unstated behavior calls for.

`specs/ui.md` now states the rule at source strength: while sound is muted the
game starts no sound at all, so a muted cue is not played and then silenced, it is
not played. Two items read it. `controls.mute-m` asserts the binding flips
`muted`. `audio.mute-silences` asserts the stated rule through the honest signal
each configuration has: under an engine no `cue:played` reaches the bus while
muted, and under `none` the page-side audio shim reports no source started.

## An item whose claim is a difference captures both states

As first written, `color.ship-band` declared one output, so its evidence was a
single still of a ship on one band while its claim was that the two bands are told
apart. A reviewer looking at that capture could not see the thing the item
asserted.

`v1.0.0` gave that one item a capture per band. `v2.0.0` makes it a rule over the
whole checklist: an item whose claim is a difference between two renders declares
the before-and-after pair, and an item measuring a difference inside one render
declares the single render its assertion turns on.
`presentation.ship-reads-band` is the first kind and declares `cyan` and
`magenta`; `overload.telegraph-drawn` is the second and declares one capture of
three drones at charge zero, one and two.

## The build ships a showcase, and no proof captures

`specs/proof.md` and the five `[[proof]]` entries are gone. The build is asked
instead for a `showcase/` at its project root — its own store-page presentation of
the game, a player-facing description and a short carousel of captured media — and
every piece of media a reviewer sees beside a verdict is captured by this case's
own validator suites, from scenarios the case controls.

The showcase is a deliverable, so it carries a point: `showcase.exists`, worth
three rather than one and capped at `great`. Its validator drives nothing — it
reads the produced tree and confirms `showcase/showcase.md`, `showcase/showcase.toml`
and one file the carousel names are there — and nothing else on the checklist
asserts anything about the media, which is the reviewer's to judge.
