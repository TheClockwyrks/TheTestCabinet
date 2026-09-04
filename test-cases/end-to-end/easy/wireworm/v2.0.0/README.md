# Wireworm — `v2.0.0`

This is version `v2.0.0` of the **Wireworm** test case. The implemented game is
an original fixed-shooter arcade game: a segmented data-worm winds down a
circuit board through a field of capacitor nodes, and a defrag cursor pinned to
a shallow band along the floor fires upward to cut it apart. Every node the worm
is turned by gains charge, and a bolt into a fully charged node detonates a
chain-arc through the charged cluster around it, clearing those nodes and frying
the worm segments caught in the arc.

`wireworm` is the catalog slug for this lineage of charged-terrain fixed-shooter
cases, and the game's in-fiction title. The case keeps the genre's defining
hooks — a segmented enemy winding down a field of destructible terrain, split in
two when shot mid-body, and a shooter confined to a shallow band — and layers its
own signature on top of them: a field that holds charge, a chain-arc discharge,
and a field that thickens from the player's own fire. The name, the look, the
charge model, the discharge, the critical-node dive and the three foes are
original to The Test Cabinet.

A model is handed a configured TypeScript project, the game's sprite art, and the
specification, and builds the game inside that project. How much of the build the
project hands over depends on the engine the run selects.

## Why this case

Wireworm is a large build for an `easy` case, and its size is breadth rather than
depth. There is no physics, no opponent to model, and nothing tuned by feel:
every rule is stated over a `40 x 20` grid of `32`-unit tiles. What the case asks
for is many exact rules holding at once — a worm on its own step clock that
winds, drops, oscillates, dives and splits into independent worms; a four-state
charge model with a chain-arc discharge that floods a connected cluster and stops
at an inert node; a field that grows from the player's own fire and persists
across levels; three foes with distinct motion, distinct effects on the field and
distinct level gates; a band-bound cursor; a twelve-level run with a win and a
loss; six screens; a HUD; and ten audio cues. A build that is nearly right in
many places is told apart from one that is right.

## Engines

The case supports three engines and seeds a different project for each, which is
what the manifest's `[workspaces]` table is for:

| Engine          | What the seeded project supplies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`          | The toolchain configuration, `index.html`, and the sprite art under `assets/`. There is no `src/`: the build writes the game and the runtime under it, meaning the frame loop and its delta time, the canvas fit, keyboard input, audio, image loading, the overlay and the `window.__wireworm` surface. The surface additionally carries the clock, as `setAutoStep` and `advance`, because nothing outside the build owns it.                                                                                                                                                                                                                                       |
| `simple-2d`     | The [Simple 2D](/engines/simple-2d/) package, vendored at seed time, plus `src/constants.ts` and `src/main.ts`. The build writes `src/game.ts`: `WirewormState`, the debug surface `specs/instrumentation.md` specifies, `BACKGROUND`, and the three functions. Its `initialize` returns the surface beside the state as `[state, debug]`, which the engine serves from `engine.debug`. The engine holds the state by value: `update` is handed it as `DeepReadonly<WirewormState>` and returns the next state, `render` is handed that state read-only, and a pose on the surface takes the state and returns the next, driven through `engine.apply`.               |
| `structured-2d` | The [Structured 2D](/engines/structured-2d/) package, vendored the same way, plus `src/constants.ts` and `src/main.ts`. Its constants also name the level, the action bindings and the cue names. The build writes `src/game.ts`, which is deliberately absent from the seed: the `GameDefinition`, the game instance whose `initialize` registers the actions and cues and returns the debug surface, the game mode whose `gameStateClass` is the live `WirewormState`, the actors, components and controller the board is drawn and driven by, and `BACKGROUND`. The world is live, so the surface's poses take only their own arguments and act on it at the call. |

Wireworm runs in **one** world for the whole session under `structured-2d`: every
screen is a value of the state's `screen` field rather than a level of its own.

The game all three projects describe is the same one, so the review items are the
same under any engine and a score recorded under one is comparable with a score
recorded under another. The specs and the validators branch where the deliverable
differs, and nowhere else.

## The single variant

Wireworm ships one variant, `base` (`variants/base.toml`): the twelve-level
Descent, on the one board geometry, with all three foes. Nothing in the seeded
set branches on `variant.slug`. The three foes are not variants and neither are
the twelve levels — a variant is a difference in the game a run is asked to
build, and the foes and levels are what one build already contains, gated by the
level the player has reached. Every spec is therefore common and seeded for every
run, and the `.hbs` templates branch on `engine.slug` alone.

## Contents

| Path                   | Seeded to run? | Purpose                                                                 |
| ---------------------- | -------------- | ----------------------------------------------------------------------- |
| `specs/`               | Yes            | The spec handed to the model, by concern.                               |
| `assets/`              | Yes            | The sprite art the game draws its nodes, worm, cursor and foes from.    |
| `workspaces/`          | Yes            | The starter TypeScript project, `<engine>/`, seeded at the run root.    |
| `prompt.hbs`           | No             | Rendered into the model's prompt; not seeded.                           |
| `references/`          | No             | The authored, correct build, one directory per engine. Never seeded.    |
| `validation/`          | No             | The validator suites deciding every review point, `<engine>/`.          |
| `validation-baseline/` | No             | The baseline media, captured from each reference build.                 |
| `showcase/`            | No             | The variant's demo media and description for the catalog.               |
| `test-case.toml`       | No             | Manifest: workspaces, engines, toolchain, specs, domains, review items. |
| `variants/`            | No             | One TOML file per variant (listed in `variants`).                       |
| `description.md`       | No             | The site-facing introduction on the case's detail page.                 |
| `changelog.md`         | No             | This version's entry in the case's changelog.                           |
| `README.md`            | No             | This overview.                                                          |

The specification is split across `specs/` by concern, and every file is seeded
for every run. Each rule lives in exactly one file.

| Spec                 | Covers                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `overview.md`        | What is built, what stays as it is, the stage and the center convention, the code quality, the commands run over the finished repository, and what a player must read at a glance. |
| `board.md`           | The HUD bar and the board, the `40 x 20` grid, the player band and the cursor's `y` range, and sole ownership of the tile-to-stage map.                                            |
| `nodes.md`           | The four charge states, what raises and caps charge, what a bolt does to a node at each charge, the starting scatter, and how the field grows and persists.                        |
| `discharge.md`       | Detonating a critical node: the chain through the connected charged cluster, what conducts and what does not, the segments it fries, and the arcs it reports.                      |
| `worm.md`            | The worm's step clock and its closed-form interval, its length, how it winds, drops, reverses, oscillates and dives, and how a bolt shortens or splits it.                         |
| `foes.md`            | The glitch, the dropper and the corruptor: their motion, their effect on the field, their level gates and spawn pacing, and the bolts each takes to kill.                          |
| `cursor.md`          | The band clamp, the movement rate and the diagonal rule, the bolts and what they stop at, and sole ownership of the contact rule that costs a life.                                |
| `controls.md`        | Every action the game answers to and the keys bound to it, menu navigation, pause, mute, and the overlay toggle.                                                                   |
| `progression.md`     | Three lives, what costs one, the respawn and its invulnerability, the twelve-level run, the banner and when a worm enters, victory and game over.                                  |
| `scoring.md`         | Every score figure, the level-clear and victory bonuses, and the bonus life.                                                                                                       |
| `ui.md`              | The six screens and their menus, the HUD readouts, the ten audio cues, and the mute requirement.                                                                                   |
| `assets.md`          | The six sprite folders, their frame counts, which frame is drawn for which state, the animation rates, the mirroring rule, and what is drawn in code.                              |
| `state.md`           | What the game's state carries, in the shape the selected engine holds it in.                                                                                                       |
| `instrumentation.md` | The deterministic core, every operation of the debug and automation surface, the snapshot shape, and the debug overlay.                                                            |
| `showcase.md`        | The player-facing description and captured carousel the finished game ships beside its source.                                                                                     |

`board.md`, `nodes.md`, `discharge.md`, `worm.md`, `foes.md`, `cursor.md`,
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

## Assets and media

This version seeds six sprite directories under `assets/`, each a folder of
`32 x 32` per-frame PNGs on a transparent background: `node/` (five frames, one
per charge plus the critical pulse), `worm/` (six frames, head, body and tail at
two frames each), `cursor/` (one), `glitch/` (four), `dropper/` (one) and
`corruptor/` (four). They are the finished pixel art produced by The Test
Cabinet's own asset-generation cases, so each folder's layout and frame count
match the matching case's output exactly. Every build renders the game from the
same art and differs only in the code around it, which is what makes two runs of
this case comparable to look at. Everything with no sprite — the board and its
grid, the player band, the bolts, the chain arcs, the HUD and every screen — is
drawn in code.

The case declares no reference mockups and no proof captures. The media a
reviewer looks at is produced by the validators under `validation/`, from
scenarios the case controls, and the same suites run against each engine's
reference build to produce the baseline it is shown beside.

## Validation

This case is validator-rated: every one of the `227` items on the checklist
carries a Vitest suite, and the validators decide the functional rating through
each item's failure cap. A reviewer rates the run's aesthetics through the four
domains and may override a verdict.

`validation/` holds one project per engine, `validation/none/`,
`validation/simple-2d/` and `validation/structured-2d/`, each with a suite per
review point at `<category>/<id>.test.ts`. The `none` suites drive the built site
in headless Chromium through `window.__wireworm`, taking the game off real time
with `setAutoStep(false)` and stepping it with `advance`; the two engine projects
run in process against the vendored engine, standing it up over an
`@napi-rs/canvas` canvas and a clock of their own and reaching the surface
through `engine.debug`. The three run the same scenarios and differ only in how
they reach the build.

Every scenario poses a world holding only what its point is about. A fixture
empties the four rosters, turns off the three world gates — the level's own foe
spawning, the level's and the respawn's worm entry, and the cursor's contact test
— and then adds back exactly the entities the requirement concerns, holding each
entity's own faculties (a worm's step and its body's follow; a foe's mind and its
travel) so nothing else in the scenario can move. Every expected value a suite
asserts comes from a figure the specs fix, never from a reference build.

`validation-baseline/<engine>/base/` holds the media the same suites captured
from that engine's reference build, so a reviewer sees the run's evidence and the
reference's side by side.

## Scoring

A run is rated on four domains — `charge` (the node field and the discharge),
`worm` (the data-worm itself), `arcade` (the cursor, the foes and the run) and
`presentation` (the screens, the HUD, the art and the audio) — and its overall
rating is the worst of the four. The `227` checklist items are grouped into
sixteen categories, and each names the domains its failure lowers and how far it
lowers them. All but one are worth a point apiece; `showcase.exists` is worth
three, because it grades a deliverable of its own rather than a behavior of the
game.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/end-to-end/easy/wireworm/v2.0.0/`). Each version is self-contained
and immutable once a run references it; design revisions land as new version
folders.
