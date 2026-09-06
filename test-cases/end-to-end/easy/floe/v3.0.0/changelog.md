## Floe is a TypeScript project, on one of three engines

This version stops asking a model for a self-contained page built on top of a
bare `package.json` and asks it for a real project instead. A run is seeded with
a complete TypeScript workspace, with Vite, `tsc`, ESLint, Prettier and Vitest
already configured, an `index.html` holding the canvas, and the sprite art under
`assets/`. How much of that project the model writes is what the engine decides.

Under [Simple 2D](/engines/simple-2d/) and [Structured
2D](/engines/structured-2d/) the workspace also carries the case-owned modules
around the game, `src/constants.ts` and `src/main.ts`, and the model writes
`src/game.ts` against them. Everything the specification fixes as a number, a key
binding, a cue name or a piece of screen copy has a name in `src/constants.ts`,
and the specs cite those names rather than restating the figures. The engine owns
the frame loop, the canvas fit, keyboard input as named actions, audio as named
cues, asset loading and the debug overlay; Structured 2D also owns rendering and
the framework the game is written inside, so the game there is a game definition,
an instance, a mode, actors, components and a controller. What stays the build's
is Floe itself: the strait, the sixteen lanes, the hop, the bear, the bays and
everything drawn.

Under `none` the workspace is that toolchain and nothing else, and there is no
`src/` at all. The model writes every line of what runs, from the frame loop and
the fixed-tick accumulator up to the game.

## Three engines, one game

Because all three projects deliver the same game, the review items, the domains
and the validators that decide them are the same across engines, and a score
recorded under one engine is comparable with a score recorded under another. The
specs branch only where the deliverable differs, on `engine.slug` and never on
the variant. The one `base` variant ships a reference implementation per engine,
under `references/<engine>/`, and the case's Reference tab offers a switch
between them.

## The fixed step is the game's rule, not the harness's

`v2.0.0` declared `tick_hz = 120`, so the rate the simulation runs at was a
property of the harness that drove the build. `v3.0.0` declares none. The fixed
step is stated in `specs/overview.md` as `TICK_HZ` (`120`) with `TICK_DT` equal
to `1/120` s, as a rule of the game like any other, and
`instrumentation.tick-length` decides that a build actually holds to it. Under an
engine a validator supplies its own clock and asks for exactly the ticks it
wants; under `none` it takes the game off real time with `setAutoStep(false)` and
counts them out with `advance`.

## The produced code is type-checked, linted, formatted and tested

A `[toolchain]` table declares four commands run over the produced tree once it
is installed: `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .`, and
`npx vitest run --coverage`. They run against the code the model wrote, and their
results are carried on the run. `specs/overview.md` names the same four, so the
build knows what it is held to.

## Every review point is decided by a validator

The checklist grew from `83` points to `216`, and every one of them now names a
Vitest suite under `validation/<engine>/`, the domains its failure lowers, and
how far it lowers them. In `v2.0.0` twelve of the eighty-three points carried no
script at all: the feel of a hop, the look of the strait and every audio cue were
left to a reviewer's ear and eye. They are validated now — a cue by the calls the
build makes to its own audio path, the strait by the pixels it renders — and what
is left to the reviewer is how good it all is rather than whether it is there.

The `71` standalone `.mjs` browser drivers are gone with the flat `validation/`
tree that held them. Under `none` a suite drives the built site in headless
Chromium through `window.__floe`; under either engine the same scenario runs in
process against the vendored engine, standing it up over a canvas and a clock of
its own and reaching the surface through `engine.debug`.

## Four domains instead of two

`v2.0.0` rated a run on `hunter` and `crossing`, so the timer, the eight levels,
every score figure and all six screens were folded into the same number as the
hop and the lanes, and the art and the audio were rated nowhere at all. A run is
now rated on `hunter`, `crossing`, `run` and `presentation` independently, and
its overall functional rating is the worst of the four, so a build whose bear is
exact and whose scoring is wrong is told apart from one where it is the other way
round.

## The debug surface poses one field at a time

The `v2.0.0` surface could not pose a scenario cleanly. `setLane(row, spec)`
repopulated a lane and re-motioned it in one call, so the case imposed its own
layout on the build rather than setting a field. `setBear(index, pose)` took
three different things in one argument — a tile, a strait-local pixel position
and a removal. `startGame()` and `setLevel(n)` each arranged several things at
once, so what a scenario had actually posed was never one thing. Nothing emptied
the strait: clearing it took sixteen `setLane` calls and one `setBear(i, null)`
per slot. No entity carried an id, so a bear was addressed by its slot and a
vehicle or a floe not at all. And `snapshot()` reported nothing of `bearAI`, so
the one operation `v2.0.0` added to hold a scene still could not be checked by
reading the state back.

Every operation is now atomic, takes scalars, and is verifiable by set-then-read:
each one sets one field, reads the state, or moves the clock, and `snapshot()`
reports every field a pose can set. A lane is laid out with `clearVehicles()` and
one `addVehicle(row, kind, x)` per item, and parked with `setLaneSpeed(row, 0)`,
which moves nothing. A bear is placed with `setBearTile(id, col, row)` or, when
the scenario needs it mid-glide, `setBearPosition(id, x, y)`, and driven a tile
with `setBearStep(id, direction)`. `clearVehicles`, `clearFloes`, `clearBears`,
`clearBays`, `clearFish` and `removeCritter` empty exactly one roster each, so a
check can pose a strait holding only what it is about. Every bear, vehicle and
floe carries an `id`, and an entity added through the surface is appended to its
roster.

`keyDown`, `keyUp` and `press` are gone. The keyboard belongs to the runtime
layer beneath the game, so a validator drives real key edges at the page or
dispatches an event at the target the engine listens on, and the build's own
binding table is what is being exercised. There is deliberately no `setMuted`
either: mute is reached the way a player reaches it, through the `mute` action,
and `muted` reports the runtime's own mute bit.

## Every scenario poses a strait holding only what it is about

Emptying the rosters is not enough on its own, because four faculties belong to
the run rather than to any entity in it and walk into a scenario that never asked
for them. A bear emerges three rows and `0.6` s into any scenario that runs that
long, so every check above the near shore was being invaded by the hunter. A
posed bear pursues, so a long hunter scenario ended in a catch that emptied the
board and cost a life. A fish surfacing in the bay a scoring check aimed at
silently added `200` to the number under test. And a scenario that ran thirty
seconds of game time expired the crossing timer and killed the critter.

Each of those is now one gate: `setBearEmergence`, `setCatchTest`,
`setFishCadence` and `setTimerRunning`, each gating one faculty and nothing else,
each on by default, each restored to on by `reset`, and each reported by
`snapshot()`. The shared fixture turns all four off, and exactly the items whose
requirement *is* one of those faculties turn the one they need back on.

`setBearAI(enabled)` is gone with them. It was one switch over the whole
creature and over every hunter slot at once, so a check that wanted to measure
how fast a bear travels had to freeze its brain along with its route, and a check
on where its routing sends it had no way to stop it travelling there. The bear
now carries three gates of its own — `setBearSense`, `setBearRouting` and
`setBearTravel`, addressed per bear by id — so a check on the route reads the
step a bear committed to with nothing moving, a check on the speed reads a rate
rather than a route, and a check that wants a bear as a pure obstacle turns off
all three.

## One coordinate system

`v2.0.0` reported a bear's and the critter's position in strait-local pixels,
measured from the top of the strait, while every distance in the specs was
measured from the top of the stage. Two systems in one case invite an off-by-`80`
that no validator can tell from a real defect, because both readings are
plausible numbers for the same entity. `v3.0.0` uses stage coordinates
everywhere, in the specs and in everything the surface reports, and
`specs/strait.md` owns the one tile-to-stage map the whole case is written
against.

## The specification is rewritten, and every rule has one home

The eleven spec files become fifteen, renamed so a reader can predict a file's
contents from its name and find a given rule in exactly one of them.
`playfield.md` becomes `strait.md` and takes sole ownership of the tile map;
`hazards.md` becomes `ice.md` so the two band files pair by name; the hopping
half of `controls.md` moves to `hopping.md`, which now owns every rule that
refuses a hop, leaving `controls.md` the keys alone; and `gameplay.md` splits
into the simulation section of `overview.md`, `progression.md` and `scoring.md`.
Seven of the fifteen are Handlebars templates rendered on the engine axis before
they land, so each seeded set reads as one self-contained game with no
alternative in view.

## No palette and no typeface

`v2.0.0` wrote a twenty-five entry canonical palette and a monospace requirement
into `specs/overview.md`, and a `color` category of review items behind it. Those
checks claimed to measure whether a player can tell the ice from the water and
the critter from the floe under it. What they actually measured was whether the
build had used the hex values the case had picked, which is a different question
with a different answer: a strait drawn in a designer's own palette failed them,
and a strait drawn in the case's palette with no contrast between two adjacent
bands passed.

The palette and the typeface are gone, and so is the `color` category. What the
specification fixes about appearance is now stated as legibility a player depends
on — the five bands told apart at a glance, deep water distinct from a floe on
the same row, a submerged bear still trackable, a vehicle reading as covering
every tile it spans — and the `strait` and `presentation` items decide exactly
that, from the pixels the build renders, against a stated distance out of `441`
rather than against a hex value. How good the strait looks is rated through the
run-wide aesthetic rating.

## The bays sit at exact columns

`v2.0.0` placed the five bays "centered near columns 4, 12, 20, 28, and 36",
which leaves one tile of latitude in where each two-tile opening actually sits.
Its checks worked around that by posing every bay entry at the one column both
readings contain, so the item that claimed to decide where the bays are was
deciding only that a bay exists somewhere near there. The latitude is removed at
the source: the five column pairs are fixed exactly, as `(3,4)`, `(11,12)`,
`(19,20)`, `(27,28)` and `(35,36)`, and every other column of the bay row is
solid. `strait.bay-columns` now hops at each pair in turn and reads which bay
filled, and `strait.far-shore-solid` reads a refusal at each solid column
between them.

## The showcase replaces the proof captures and the reference mockups

`specs/proof.md`, the five `[[proof]]` entries and the `proof/` artifacts a build
was asked to record are gone, and so are the two seeded reference screenshots.
The screenshots were illustrative of a look the specification no longer fixes,
and a build was being shown a picture it was told not to reproduce. What the
finished game ships instead is a showcase: a `showcase/` directory holding a
player-facing description and a short carousel of captured media, framed as the
game's own store-page presentation rather than as evidence. Every piece of media
a reviewer sees beside a verdict is produced by the case's own validators, from
scenarios the case controls, beside the same media captured from the reference.

## What v2.0.0 fixed stays fixed

Every correction `v2.0.0` made survives this rewrite, carried by an item or by
the specs' own wording rather than by the operation or sentence that carried it
before.

| What `v2.0.0` fixed | What carries it now |
| --- | --- |
| A scene can be built around a bear that stays put without making it immune to the world | The three per-bear gates, decided by `instrumentation.bear-sense-gate`, `instrumentation.bear-routing-gate` and `instrumentation.bear-travel-gate` |
| A lane's motion changes without disturbing its contents | `setLaneSpeed` and `setLaneDirection`, neither of which repopulates a lane; `instrumentation.poses-read-back` |
| A bear is driven a tile without consulting its route | `setBearStep`, exercised by `hunter.refuses-vehicle-tile`, `hunter.never-enters-far-shore` and `hunter.reset-on-entering-tile` |
| A bear is placed mid-glide, between two tiles | `setBearPosition`, exercised by `hunter.glides-continuously` and `hunter.turns-at-tile-centres` |
| A vehicle's tile is closed to the bear: the move is refused rather than taken and forgiven | `hunter.refuses-vehicle-tile` |
| A completed crossing scores its last row, `10 + 50 + 2 * T` | `scoring.last-hop-total`, with `scoring.row-advance`, `scoring.bay-award` and `scoring.time-bonus` deciding the three parts separately |
| The HUD's LIVES readout counts the run's lives, so a fresh run reads three | `presentation.hud-lives` |
| Every death pauses before the respawn and the critter is out of play for its duration | `progression.death-pause`, `progression.critter-out-of-play` and `progression.strait-runs-during-death` |
| The render-decoupling requirement states the one-way dependency and nothing about how the renderer presents state | The wording of `specs/instrumentation.md`, asserted by `instrumentation.tick-length` |
| The reference draws between simulation steps rather than on the tick boundary | A requirement on all three reference implementations: the interpolation state is written by the step and read only by the renderer |
| Mute is toggled during a live crossing, where the game is making the sound | `controls.mute-m` and `audio.mute-silences` |
| A critter left on the near shore is not hunted at all | `hunter.no-emergence-on-near-shore`, beside `hunter.emerges-after-advance` |
| The timer costing a life requires the clock to have actually run down | `progression.timer-costs-life`, which reads `timer` at `0` and the phase turning to `dying` in the same tick |
| A clip that ends on an event keeps rolling, and one that begins on an event opens before it | Every recording is armed around the section its item is about, never around the arrangement that got there |
