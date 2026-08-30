# Floe — `v3.0.0`

This is version `v3.0.0` of the **Floe** test case. The implemented game is an
original single-screen arcade crossing game: a small tundra critter hops one tile
at a time across a frozen strait, first over eight lanes of sliding traffic, then
over a median shelf, then over eight lanes of open water by riding the floes
drifting along them, to fill five bays cut into the far shore. A polar bear
emerges behind it and hunts it across the whole strait.

`floe` is the catalog slug for this lineage of crossing cases, and the game's
in-fiction title. The case keeps the genre's defining hook — hop a grid across
alternating bands of avoid-hazards and ride-platforms to safe slots at the far
edge — and layers its own signature on top of it: a live pursuing predator that
glides the same grid the critter hops, routes around the same traffic, and swims
out over the water after it. The name, the look, the arctic strait, the drifting
carry-floes, the goal bays, and the hunter are original to The Test Cabinet.

A model is handed a configured TypeScript project, the game's sprite art, and the
specification, and builds the game inside that project. How much of the build the
project hands over depends on the engine the run selects.

## Why this case

Floe is a large build whose size is breadth rather than depth. There is no
physics and no opponent to tune by feel: the strait is a `40 x 20` grid of
`32`-unit tiles, every rate is a constant, and every rule is stated over that
grid. What the case asks for is many exact rules holding at once — sixteen
populated lanes that wrap without breaking their spacing, a carry model that
drifts a rider with the floe under it, a hunter that glides continuously between
tile centres and routes around moving traffic, five bays with a bonus catch on
its own cadence, a per-crossing timer, an eight-level run that speeds everything
up and adds a second bear, six screens, a HUD, ten audio cues, and — under `none`
— the whole runtime layer beneath all of it. A build that is nearly right in many
places is told apart from one that is right.

The bear is what the case is for. It is the one system with no fixed track: it
reads where the critter is, chooses a step, and is stopped only by the same
hazards the player dodges, so no tile is safe to wait on and every rule the
crossing states has to hold while something is chasing you through it.

## Engines

The case supports three engines and seeds a different project for each, which is
what the manifest's `[workspaces]` table is for:

| Engine | What the seeded project supplies |
| --- | --- |
| `none` | The toolchain configuration, `index.html`, and the sprite art under `assets/`. There is no `src/`: the build writes the game and the runtime under it, meaning the frame loop and the fixed-tick accumulator, the canvas fit, keyboard input, image loading, audio, the overlay, and the `window.__floe` surface. That surface additionally carries the two clock operations, `setAutoStep` and `advance`, because nothing outside the build owns the clock. |
| `simple-2d` | The [Simple 2D](/engines/simple-2d/) package, vendored at seed time, plus `src/constants.ts` and `src/main.ts`. The build writes `src/game.ts`: `FloeState`, `FloeDebugApi`, `BACKGROUND`, and the three functions. Its `initialize` returns the debug surface beside the state as `[state, debug]`, which the engine serves from `engine.debug`. The engine holds the state by value, so `update` is handed it as `DeepReadonly<FloeState>` and returns the next state, and a pose on the surface takes the state and returns the next, driven through `engine.apply`. |
| `structured-2d` | The [Structured 2D](/engines/structured-2d/) package, vendored the same way, plus `src/constants.ts` and `src/main.ts`. Its constants also name the level, the action bindings, and the cue names. The build writes `src/game.ts`, deliberately absent from the seed: the `GameDefinition`, the game instance whose `initialize` registers the actions and cues and returns the debug surface, the game mode whose `gameStateClass` is the live `FloeState`, the actors, components, and controllers the strait is drawn and driven by, and `BACKGROUND`. The world is live, so the surface's poses take only their own arguments and act on it at the call. |

Floe runs in **one** world for the whole session under `structured-2d`: every
screen is a value of the state's `screen` field, and a level advance in Floe's
own sense rearranges the strait rather than opening a world.

The game all three projects describe is the same one, so the review items are the
same under any engine and a score recorded under one is comparable with a score
recorded under another. The specs and the validators branch where the deliverable
differs, and nowhere else.

## The single variant

Floe ships one variant, `base` (`variants/base.toml`): the eight-level run on the
one strait, with the bear. Nothing in the seeded set branches on `variant.slug`.
The eight levels are not variants and neither are the six screens — a variant is a
difference in the game a run is asked to build, and the levels and screens are
what one build already contains. Every spec is therefore common and seeded for
every run, and the `.hbs` templates branch on `engine.slug` alone.

## Contents

| Path | Seeded to run? | Purpose |
| --- | --- | --- |
| `specs/` | Yes | The spec handed to the model, by concern. |
| `assets/` | Yes | The sprite art the game draws its critter, bear, vehicles and floes from. |
| `workspaces/` | Yes | The starter TypeScript project, `<engine>/`, seeded at the run root. |
| `prompt.hbs` | No | Rendered into the model's prompt; not seeded. |
| `references/` | No | The authored, correct build, one directory per engine. Never seeded. |
| `validation/` | No | The validator suites deciding every review point, `<engine>/`. |
| `validation-baseline/` | No | The baseline media, captured from each reference build. |
| `showcase/` | No | The variant's demo media and description for the catalog. |
| `test-case.toml` | No | Manifest: workspaces, engines, toolchain, specs, domains, review items. |
| `variants/` | No | One TOML file per variant (listed in `variants`). |
| `description.md` | No | The site-facing introduction on the case's detail page. |
| `changelog.md` | No | This version's entry in the case's changelog. |
| `README.md` | No | This overview. |

The specification is split across `specs/` by concern, and every file is seeded
for every run. Each rule lives in exactly one file.

| Spec | Covers |
| --- | --- |
| `overview.md` | What is built, what stays as it is, the stage, the position conventions, the fixed timestep, the code quality, the commands run over the finished repository, and what a player reads at a glance. |
| `strait.md` | The HUD bar and the strait, the `40 x 20` grid, the five bands, the five bays' column pairs, and sole ownership of the tile-to-stage map. |
| `hopping.md` | One tile per press, the hop cooldown and auto-repeat, where an accepted hop lands, and sole ownership of every rule that refuses a hop. |
| `ice.md` | The eight ice lanes, the three vehicle kinds, the population model and its wrap, the per-level scaling, and the covering rule. |
| `water.md` | The eight water lanes, the three floe kinds, the carry a rider takes from the floe under it, deep water, and being carried off the stage. |
| `bays.md` | The five goal bays, what filling one does, when a level clears, and the bonus catch's cadence. |
| `hunter.md` | The bear: its continuous glide, its ice and swim speeds, its emergence, its routing around traffic, the reset a vehicle deals it, and its catch. |
| `progression.md` | Three lives and what costs one, the crossing timer, the three sub-phases and their pauses, the eight-level run, victory, game over, the bonus life, and what a pause suspends. |
| `scoring.md` | Every score figure, the worked total for a completing hop, and the level and victory bonuses. |
| `controls.md` | Every action the game answers to and the keys bound to it, menu navigation, pause, mute, and the overlay toggle. |
| `ui.md` | The six screens and their menus, the five HUD readouts, the ten audio cues, and the mute requirement. |
| `assets.md` | The seven sprite folders, their frame counts, which frame is drawn for which state, the mirroring rule, and what is drawn in code. |
| `state.md` | What the game's state carries, in the shape the selected engine holds it in. |
| `instrumentation.md` | The render-free core, every operation of the debugging and automation surface, the snapshot shape, and the debug overlay. |
| `showcase.md` | The player-facing description and captured carousel the finished game ships beside its source. |

`strait.md`, `hopping.md`, `ice.md`, `water.md`, `bays.md`, `hunter.md`,
`progression.md` and `scoring.md` are plain Markdown, identical under every
engine. `overview.md.hbs`, `controls.md.hbs`, `ui.md.hbs`, `assets.md.hbs`,
`state.md.hbs`, `instrumentation.md.hbs` and `showcase.md.hbs` are Handlebars
templates rendered on the engine axis before they land. Because the branching
resolves at seed time, each seeded set reads as one self-contained game with no
alternative in view.

Under `simple-2d` and `structured-2d`, every figure the specification fixes is
exported from the seeded `src/constants.ts` under the name the specs cite, and
`specs/overview.md` tells the build that constant is the authoritative one. Under
`none` there is no seeded constants module, and each figure is named once in a
module of the build's own.

There is one coordinate system in this version, the stage's, and `strait.md`
carries the whole tile-to-stage map. Every position the specs state and every
position the debug surface reports is measured from the stage's top-left corner.

## Assets and media

This version seeds seven sprite directories under `assets/`, each a folder of
per-frame PNGs on a transparent background: `crosser/` (eight frames, a
crouch-and-leap pair per facing), `bear/` (eighteen, running, swimming and
lunging), `plow/` (one, `96 x 32`), `dogsled/` (one, `64 x 32`), `car/` (one,
`64 x 32`), `pan/` (one, `32 x 32`) and `raft/` (two, `128 x 32`, the three-tile
and four-tile floes). They are the finished pixel art produced by The Test
Cabinet's own asset-generation cases — `floe-crosser`, `floe-bear`, `floe-plow`,
`floe-dogsled`, `floe-car`, `floe-pan` and `floe-raft` — so each folder's layout
and frame count match the matching case's output exactly. Every build renders the
game from the same art and differs only in the code around it, which is what
makes two runs of this case comparable to look at. Everything with no sprite —
the ice, the water, the shores, the bays, the bonus catch, the HUD and every
screen — is drawn in code.

The case fixes no palette and no typeface. What the specification fixes about
appearance is stated as legibility a player depends on: the five bands told apart
at a glance, deep water distinct from a floe on the same row, a submerged bear
still trackable, a vehicle reading as covering every tile it spans. How good the
strait looks is rated through the run-wide aesthetic rating instead.

The case declares no reference mockups and no proof captures. The media a
reviewer looks at is produced by the validators under `validation/`, from
scenarios the case controls, and the same suites run against each engine's
reference build to produce the baseline it is shown beside.

## Validation

This case is validator-rated: every one of the `216` points on the checklist
carries a Vitest suite, and the validators decide the functional rating through
each point's failure cap. A reviewer rates the run's aesthetics separately and
may override a verdict.

`validation/` holds one project per engine, `validation/none/`,
`validation/simple-2d/` and `validation/structured-2d/`, each with a suite per
review point at `<category>/<id>.test.ts`. The `none` suites drive the built site
in headless Chromium through `window.__floe`, taking the game off real time with
`setAutoStep(false)` and stepping it with `advance`; the two engine projects run
in process against the vendored engine, standing it up over an `@napi-rs/canvas`
canvas and a clock of their own and reaching the surface through `engine.debug`.
The three run the same scenarios and differ only in how they reach the build.

Every scenario poses a strait holding only what its point is about. A fixture
clears the vehicles, the floes and the bears, turns off the four world gates —
the run's own emergence of bears, the catch test, the bonus catch's cadence, and
the crossing timer's drain — and then adds back exactly the entities the
requirement concerns, holding each bear's own faculties (its sense of the
critter, its routing, its travel) so nothing else in the scenario can move. Every
expected value a suite asserts comes from a figure the specs fix, never from a
reference build.

`validation-baseline/<engine>/base/` holds the media the same suites captured
from that engine's reference build, so a reviewer sees the run's evidence and the
reference's side by side.

## Scoring

A run is rated on four domains — `hunter` (the bear), `crossing` (the hop, the
two bands and the bays), `run` (the lives, the timer, the levels, the score and
the screens) and `presentation` (the art, the HUD, the legibility and the audio)
— and its overall functional rating is the worst of the four. The `216` checklist
points are grouped into thirteen categories, and each point names the domains its
failure lowers and how far it lowers them.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/end-to-end/easy/floe/v3.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
