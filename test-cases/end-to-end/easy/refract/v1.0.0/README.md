# Refract — `v1.0.0`

This is version `v1.0.0` of the **Refract** test case. The implemented game is
an original light-tracing puzzle titled Refract, played on a dark optical bench.
Each board is a lattice of optical nodes: emitters, lenses and crystals. The
player draws one beam per channel (`triangle`, `square`, `diamond`) between that
channel's two emitters, threading every lens of that channel and spending the
charge in every crystal it crosses. A board is solved when every beam is
complete and every crystal is exactly spent.

`refract` is the catalog slug for this case, and the game's in-fiction title.
The case belongs to the family of grid line-drawing puzzles. Its name, its look,
the optical framing and the rule set are original to The Test Cabinet: three
channels on one board at once, charge-carrying crystals shared between them, and
mutually exclusive diagonals that stop beams from visibly crossing.

## Why this case

Refract is an `easy` end-to-end case with no physics, no opponent and no clock.
Its difficulty is one of precision. Nine rules govern a beam and split into two
halves that behave differently: five limits are checked on every pointer move
and refuse it, and four completion conditions are evaluated over a finished
board and never refuse anything. A build that confuses the two halves rejects
the first segment of every board, because an empty beam does not yet satisfy a
condition phrased with "exactly". Around that sit a seeded board generator,
pointer input resolved against a hit radius, six screens across two modes worked
by mouse, touch, and keyboard alike, and a debug surface that drives the real
input path.

## The two modes

Both modes ship in every build and are picked from the title menu. `state.mode`
is `"campaign" | "cascade"` and the snapshot reports it.

| Mode     | What it is                                                                                                                                                                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Campaign | `CAMPAIGN_LENGTH` (`24`) hand-built boards in four sets of six, listed in `specs/campaign-boards.md` and opened in order as each is solved. It uses no randomness at all. It adds the `select` grid and the `complete` screen.                                                                                                                               |
| Cascade  | One unbroken sequence with no last board. The build carries a seeded generator that emits, for a given seed and tier, a board that is solvable and meets the tier's difficulty floor — five measures bounded per tier in `specs/modes/cascade.md`. The tier climbs every `TIER_ADVANCE` (`5`) solves, five tiers deep. Generation runs off `state.rngState`. |

The six screens are the union of both modes: `title`, `howto`, `select`,
`playing`, `solved`, `complete`. `select` and `complete` are reached in Campaign
only, which the mode specs state, and they exist in every build. The snapshot
carries the campaign fields (`boardIndex`, `solvedBoards`, `unlockedCount`) and
the cascade fields (`solvedCount`, `tier`) unconditionally; a field the current
mode does not use reports its resting value, so the snapshot shape is fixed. The
Cascade mode shares its name with the catalog's separate `cascade` test case and
nothing else.

## Engines

Refract is designed for three engines, and seeds a different project for each:

| Engine          | What the seeded project supplies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`          | The toolchain configuration and `index.html`, and nothing else. There is no `src/`. The build writes the runtime, meaning the frame loop and its delta time, the canvas fit, keyboard and pointer input, audio, the overlay and the `window.__refract` surface, and then the game on top of it. The surface additionally carries the clock, as `setAutoStep` and `advance`, because nothing outside the build owns it.                                                                                                                                                                                                              |
| `simple-2d`     | The [Simple 2D](/engines/simple-2d/) package, vendored at seed time, plus `src/constants.ts` and `src/main.ts`. The build writes `src/game.ts`: `RefractState`, the debug surface, `BACKGROUND`, and the three functions. Its `initialize` returns the surface beside the state as `[state, debug]`, which the engine serves from `engine.debug`. The engine holds the state by value, so `update` is handed it as `DeepReadonly<RefractState>` and returns the next state, and the surface's operations take the state the same way. A pose returns the next state, driven through `engine.apply`; a reading returns what it read. |
| `structured-2d` | The [Structured 2D](/engines/structured-2d/) package, vendored at seed time, plus the same `src/constants.ts` and `src/main.ts`. The build writes `src/game.ts`: the `GameDefinition` with its single level, the game instance whose `initialize` returns the debug surface, the game mode that runs the screens, the `RefractState` class the world holds live as its game state, and `BACKGROUND`. The engine serves the surface from `engine.debug`. The world is live, so the surface's poses take only their own arguments and act on it at the call, and its readings return plain data.                                      |

On both engine runs the pointer belongs to the engine and reaches the build
already in logical stage units with press and release edges and the device
driving them. Simple 2D hands it over as a per-frame position and edges,
Structured 2D as the ordered per-frame samples of its input system. An engineless
build maps the page's pointer itself and takes the browser's own gestures on the
canvas, which the two engines do for a build that stands on them.
`specs/controls.md` branches accordingly. The game the three projects describe
is the same one, so a score recorded under one engine is comparable with a score
recorded under another.

## The single variant

Refract ships one variant, `base` (`variants/base.toml`), and nothing in the
seeded set branches on `variant.slug`. Campaign and Cascade are two ways to play
one game, reached from one title menu, sharing one board model, one rule set,
one control scheme and one snapshot shape. Every spec is therefore common and
seeded for every run. The `.hbs` templates branch on `engine.slug` alone.

## Contents

| Path                   | Seeded to run? | Purpose                                                                 |
| ---------------------- | -------------- | ----------------------------------------------------------------------- |
| `specs/`               | Yes            | The spec handed to the model, by concern.                               |
| `workspaces/`          | Yes            | The starter TypeScript project, `<engine>/`, seeded at the run root.    |
| `references/`          | No             | The authored, correct build, one directory per engine. Never seeded.    |
| `validation/`          | No             | The validator suites deciding every review point, `<engine>/`.          |
| `validation-baseline/` | No             | The baseline media, captured from each reference build.                 |
| `showcase/`            | No             | The variant's demo media and description for the catalog.               |
| `prompt.hbs`           | No             | Rendered into the model's prompt; not seeded.                           |
| `test-case.toml`       | No             | Manifest: workspaces, engines, toolchain, specs, domains, review items. |
| `variants/`            | No             | One TOML file per variant (listed in `variants`).                       |
| `description.md`       | No             | The site-facing introduction on the case's detail page.                 |
| `changelog.md`         | No             | This version's entry in the case's changelog.                           |
| `README.md`            | No             | This overview.                                                          |

The specification is split across `specs/` by concern, and every file is seeded
for every run:

| Spec                 | Covers                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `overview.md`        | What is built, what stays as it is, the code quality, and the commands run over the finished repository.                                           |
| `board.md`           | The grid, the cell-center formula, the node kinds, and the notation boards are written in.                                                         |
| `beams.md`           | Rules `R1`–`R9`: the five limits, the four completion conditions, and how each half is enforced.                                                   |
| `controls.md`        | Beginning, extending, retracting, and releasing a trace; the grab table; the pointer targets every screen is worked through; the keyboard actions. |
| `state.md`           | What the game's state carries.                                                                                                                     |
| `instrumentation.md` | The debug and automation surface and the diagnostics overlay.                                                                                      |
| `ui.md`              | The `title`, `howto`, and `playing` screens, the menus and their on-screen controls, and the audio cues.                                           |
| `campaign-boards.md` | The twenty-four campaign boards, authoritative for every layout.                                                                                   |
| `modes/campaign.md`  | The course, its progression, and the `select` and `complete` screens.                                                                              |
| `modes/cascade.md`   | The endless sequence, the generator's contract, and the tier ladder.                                                                               |

`board.md`, `beams.md` and `campaign-boards.md` are plain Markdown, identical
under every engine. `overview.md.hbs`, `controls.md.hbs`, `state.md.hbs`,
`instrumentation.md.hbs`, `ui.md.hbs`, `modes/campaign.md.hbs` and
`modes/cascade.md.hbs` are Handlebars templates rendered on the engine axis
before they land. Because the branching resolves at seed time, each seeded set
reads as one self-contained game with no alternative in view.

Under `simple-2d` and `structured-2d`, every figure the specification fixes is
exported from the seeded `src/constants.ts` under the name the specs cite, so a
spec never restates a number the project already names. Under `none` there is no
seeded constants module, and each figure is named once in a module of the
build's own.

## Assets and media

This version has no assets and declares no reference mockups. The geometry is
pinned to the figure: the stage, `CELL_PITCH`, the cell-center formula and
`NODE_HIT_R`. The palette, the type, the node artwork and the beam rendering are
left to the build, drawn entirely in code and rated by a reviewer through the
domains. What the specs do fix about the look is legibility: channels told apart
by hue and by silhouette, emitters outlined where lenses are filled, and
crystals showing charges spent and remaining.

## Validation

This case is validator-rated: every point on the checklist carries a Vitest
suite, and the validators decide the functional rating through each point's
failure cap. A reviewer rates the run's aesthetics and may override a verdict.

`validation/` holds one project per engine, `validation/none/`,
`validation/simple-2d/` and `validation/structured-2d/`, each with a suite per
review point at `<category>/<id>.test.ts`. The `none` suites drive the built
site in Chromium through `window.__refract`; the two engine projects run in
process against the vendored engine and reach the surface through
`engine.debug`. The three run the same scenarios and differ only in how they
reach the build.

Each project carries the same spec-derived oracle beside its harness:
`notation.ts` (the board notation, the cell-center formula, and the tier
ladder with its difficulty floor), `rules.ts` (`R1`–`R9` recomputed
independently), `solver.ts` (a bounded solver), `metrics.ts` (the floor's five
measures recomputed independently), and `routes.ts` (the `24` campaign boards
with a solving route each). Every
expected value a suite asserts comes from that oracle or from a figure the
specs fix, never from a reference build. All `24` campaign boards are solvable
under the rules as the specs state them, which is the load-bearing fact the
course rests on. No spec text claims a board is uniquely solvable.

`validation-baseline/<engine>/<variant>/` holds the media the same suites
captured from that engine's reference build, so a reviewer sees the build's
evidence and the reference's side by side.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/end-to-end/easy/refract/v1.0.0/`). Each version is self-contained
and immutable once a run references it; design revisions land as new version
folders.
