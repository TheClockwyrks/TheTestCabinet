# Coil — `v2.0.0`

This is version `v2.0.0` of the **Coil** test case, a **full-stack** case. The
implemented game is an original grid-and-growth game titled Coil: grid-locked
snake mechanics plus a combo multiplier, where pellets eaten in quick succession
score more. It ships as a `base` Classic variant and a `maze` variant that adds a
fixed course of fatal interior obstacles to thread. On top of building the game,
the model must produce the snake's own sprite set, an animated biting head with
body and corner sprites for its turns, and the game's sound and music, with the
asset-generation tools on the run image's `PATH`.

`coil` is the catalog slug for this lineage of grid-and-growth cases, and the
game's in-fiction title. The case is inspired by classic snake games and is not a
clone of any of them: the name, the look and the combo mechanic are original to
The Test Cabinet.

## Why this case

Snake's rules are among the simplest in the catalog, and this version pairs that
tidy simulation with a small art-and-audio pass, so it exercises both sides of a
build at once. The simulation has to run on a fixed timestep separated from
rendering, turning has to buffer presses without ever letting a fast double-tap
reverse the head into its own neck, self-collision turns on the cell a tail is
vacating, pellets have to keep landing on valid cells as the board crowds, and the
combo has to decay on simulation time. None of it is deep, and all of it has to be
right.

The full-stack half asks for the snake's sprite set and the game's audio to be
produced during the run with the on-`PATH` binaries and wired into the build. A
correct game with a code-drawn snake and crisp sprites bolted to a game that
mishandles turning both fall short.

## Engines

Coil is designed for three engines, and seeds a different project for each:

| Engine          | What the seeded project supplies                                                                                                                                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`          | The toolchain configuration and `index.html`, and nothing else. There is no `src/`. The build writes the fixed-tick loop and its clock, the canvas fit, keyboard input, audio, the overlay and the `window.__coil` surface, and then the game on top of it.                |
| `simple-2d`     | The [Simple 2D](/engines/simple-2d/) package, vendored at seed time, plus `src/main.ts`. The build writes `src/game.ts`. Its `initialize` returns the debug surface beside the state as `[state, debug]`, which the engine serves from `engine.debug`.                     |
| `structured-2d` | The [Structured 2D](/engines/structured-2d/) package, vendored the same way, plus the same one case-owned module. The build writes `src/game.ts`: the game definition, its mode, its live state and its actors, and the debug surface its instance's `initialize` returns. |

The asset-production pass is common to all three. No engine supplies art or sound,
so every run produces the snake's sprite set and the game's audio with the
on-`PATH` binaries against the one `specs/assets.md` contract.

## The two variants

Coil ships two variants, each a single mode:

| Variant | The game it asks for                                                                              |
| ------- | ------------------------------------------------------------------------------------------------- |
| `base`  | Classic mode on the open board.                                                                   |
| `maze`  | Maze mode on a board laced with a fixed course of fatal interior obstacles the snake must thread. |

Every spec is common and seeded for both. What differs between the two modes, the
mode's menu entry, its HUD label and the interior obstacle course, is branched by
variant slug inside `specs/mode.md.hbs`, so a run's seeded set describes exactly
one mode and reads as self-contained.

Maze declares its own `maze` scoring domain and the review points that roll up to
it. It also declares its own version of each common point whose behavior the
obstacles change, beside `base`'s version of the same point, because a variant may
add to the common checklist and never replace the validator behind one of its
points.

## Contents

| Path                   | Seeded to run? | Purpose                                                                 |
| ---------------------- | -------------- | ----------------------------------------------------------------------- |
| `specs/`               | Yes            | The spec handed to the model, by concern.                               |
| `workspaces/`          | Yes            | The starter TypeScript project, `<engine>/`, seeded at the run root.    |
| `references/`          | No             | The authored, correct build, `<engine>/<variant>/`. Never seeded.       |
| `validation/`          | No             | The validator suites deciding every review point, `<engine>/`.          |
| `validation-baseline/` | No             | The baseline media, captured from each reference build.                 |
| `showcase/`            | No             | Each variant's demo media and description for the catalog.              |
| `prompt.hbs`           | No             | Rendered into the model's prompt; not seeded.                           |
| `test-case.toml`       | No             | Manifest: workspaces, engines, toolchain, specs, domains, review items. |
| `variants/`            | No             | One TOML file per variant (listed in `variants`).                       |
| `description.md`       | No             | The site-facing introduction on the case's detail page.                 |
| `changelog.md`         | No             | This version's entry in the case's changelog.                           |
| `README.md`            | No             | This overview.                                                          |

The specification is split across `specs/` by concern, and every file is seeded
for every run:

| Spec                 | Covers                                                                      |
| -------------------- | --------------------------------------------------------------------------- |
| `overview.md`        | What is built, the runtime, the code quality, and the commands run over it. |
| `board.md`           | The cell grid, the wall border, the starting chain and pellet placement.    |
| `movement.md`        | The fixed tick, the order it resolves in, turning, growth and collision.    |
| `scoring.md`         | The score, the multiplier, its window and its cap, and the best score.      |
| `mode.md`            | The mode this run builds, its menu entry and its obstacle course.           |
| `controls.md`        | The actions, the keys bound to them, and what each does on each screen.     |
| `ui.md`              | The screens, the menus, the HUD and the audio cues.                         |
| `assets.md`          | The production contract for the assets the build must make.                 |
| `instrumentation.md` | The debug and automation surface and the diagnostics overlay.               |
| `showcase.md`        | The showcase directory the finished build ships beside its source.          |

## Assets and media

This version declares no reference mockups. The board geometry, the tick rate, the
combo window and every other figure a validator reads are fixed exactly, and the
palette, the type and the look of the board and the HUD are the build's. What a
validator reads of the drawing is only what the specs fix: that the stage is
fitted, that the pieces on the board are told apart by a stated color distance,
that the copy each screen names is drawn, and that the snake is painted from its
produced sprites. How any of it looks is the presentation domain's aesthetic
rating.

The snake's sprite set and the game's sound and music are produced during the run
with the binaries on the run image's `PATH` and committed into the build, so
`npm ci && npm run build` is self-contained and runs with the generation binaries
absent. The board, walls, obstacles, pellet and HUD stay drawn in code.

## Validation

This case is validator-rated: every point on the checklist carries a Vitest suite,
and the validators decide the functional rating through each point's failure cap.
A reviewer rates the run's aesthetics and may override a verdict.

`validation/` holds one project per engine, `validation/none/`,
`validation/simple-2d/` and `validation/structured-2d/`, each with a suite per
review point at `<category>/<id>.test.ts`. The `none` suites drive the built site
in Chromium through `window.__coil`; the two engine projects run in process
against the vendored engine and reach the surface through `engine.debug`. The
three run the same scenarios and differ in how they reach the build.

`validation-baseline/<engine>/<variant>/` holds the media the same suites captured
from that engine's reference build, so a reviewer sees the build's evidence and
the reference's side by side.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/full-stack/easy/coil/v2.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
