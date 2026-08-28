# Fathom — `v3.0.0`

This is version `v3.0.0` of the **Fathom** test case. The implemented game is an
original maze chase: a bioluminescent forager grazing plankton through a
pitch-dark maze, hidden by fog of war until the forager's light or a sonar pulse
reveals it, with three predators each hunting by a different signal the forager
gives off — its light (the Lanternjaw), its sound (the Gloamfin), or the hunter's
own flare (the Flarefish).

`fathom` is the catalog slug for this lineage of maze-chase cases, and the game's
in-fiction title. The case is inspired by classic maze-chase arcade games but is
not a clone of any of them: the name, look, sensing model, sonar, and predators
are original to The Test Cabinet. It replaces the genre's two most recognizable
beats — there are no power pellets and no eating the hunters, because a powerless
forager survives by sensing and evasion rather than by flipping the chase, and
the visible, personality-driven ghosts become predators you mostly cannot see,
felt through the dark by the tells they leak.

A model is handed a configured TypeScript project, the game's art, and the
specification, and builds the game inside that project. How much of the build the
project hands over depends on the engine the run selects.

## Engines

The case supports three engines and seeds a different project for each, which is
what the manifest's `[workspaces]` table is for:

| Engine | What the seeded project supplies |
| --- | --- |
| `none` | The toolchain configuration, `index.html`, and the art under `assets/`. There is no `src/`: the model writes the game and the runtime under it, meaning the frame loop, canvas fit, input, image loading, audio, the overlay and the `window.__fathom` surface. |
| `simple-2d` | The [Simple 2D](/engines/simple-2d/) package, vendored at seed time, plus `src/constants.ts` and `src/main.ts`. The model writes `src/game.ts`: the state, the debug surface `specs/instrumentation.md` specifies, and the three functions. Its `initialize` returns the surface beside the state as `[state, debug]`, which the engine serves from `engine.debug`. The engine holds the state by value: `update` is handed it read-only (`DeepReadonly<FathomState>`) and returns the next state, `render` is handed that state read-only, and the surface's operations take the state the same way. |
| `structured-2d` | The [Structured 2D](/engines/structured-2d/) package, vendored the same way, plus `src/constants.ts` and `src/main.ts`. Its constants also name the level, the action bindings and the cue names. The model writes `src/game.ts`: the `GameDefinition` the engine drives, holding the one level the dive runs in, the game mode that holds the screens and the rules, its actors and the controller the forager is driven through, plus the debug surface its instance's `initialize` returns and the `BACKGROUND` color `src/main.ts` hands the engine. |

Fathom runs in **one** world for the whole session under `structured-2d`: every
screen is a value of the state's `screen` field rather than a level of its own.

The game all three projects describe is the same one, so the review items are the
same under any engine and a score recorded under one is comparable with a score
recorded under another. The specs and the validators branch where the deliverable
differs.

## Contents

| Path                   | Seeded to run? | Purpose                                                                                              |
| ---------------------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| `workspaces/`          | Yes            | The starter TypeScript project, `<variant>/<engine>/` plus a shared `none/`, seeded at the run root. |
| `specs/`               | Yes            | The spec handed to the model, by concern.                                                            |
| `assets/`              | Yes            | The art the game renders its creatures, tiles and flare from.                                        |
| `prompt.hbs`           | No             | Rendered into the model's prompt; not seeded.                                                        |
| `validation/`          | No             | The case's Vitest validators, one project per engine (`<engine>/`).                                  |
| `references/`          | No             | The authored, correct build, `<engine>/<variant>/`. Never seeded.                                    |
| `validation-baseline/` | No             | The validators' media captured against the reference, `<engine>/<variant>/`, shown beside a run's.   |
| `showcase/`            | No             | Curated demo media per variant, captured from the reference build.                                   |
| `test-case.toml`       | No             | Manifest: workspaces, engines, toolchain, specs, domains, review items.                              |
| `variants/`            | No             | One TOML file per variant (listed in `variants`).                                                    |
| `description.md`       | No             | The site-facing introduction on the case's detail page.                                              |
| `changelog.md`         | No             | What changed from `v2.0.0`.                                                                          |
| `README.md`            | No             | This overview.                                                                                       |

The specification is split across `specs/` by concern, and every file is seeded
for every variant and every engine:

- `overview.md` — the stage, the tile grid, the project, and what a player reads
  at a glance.
- `maze.md` — the layout rules, the den, and the wrap tunnel.
- `movement.md` — the fixed timestep, how bodies travel the grid, and the
  controls.
- `sensing.md` — the fog of war, the light and brightness, the sonar pulse, and
  the ink.
- `gameplay.md` — the plankton, the bonus drifters, and getting caught.
- `predators.md` plus one file per kind under `predators/`.
- `progression.md` — scoring, lives, depth, the descent, and the audio cues.
- `ui.md` — the screens, the menus, the transitions, and the HUD.
- `assets.md` — the art contract.
- `state.md` — the shape of the observable state.
- `instrumentation.md` — the debugging and automation surface over it.
- `showcase.md` — the player-facing description and captured carousel the
  finished game ships beside its source.

Most are `.hbs` templates rendered before they land, on two axes. `variant.slug`
selects the sensing model, inside `sensing.md.hbs`, `ui.md.hbs`, `state.md.hbs`
and `instrumentation.md.hbs`. `engine.slug` selects what the build is handed and
what it writes, inside `overview.md.hbs`, `movement.md.hbs`, `progression.md.hbs`,
`assets.md.hbs`, `state.md.hbs`, `instrumentation.md.hbs` and `showcase.md.hbs`.
The branching resolves at seed time, so each seeded set reads as one
self-contained game with no cross-variant and no cross-engine language.

The specs name every figure they fix and state its value beside the name, on
every engine. Under an engine that seeds one, that same name is exported from the
seeded `src/constants.ts`, and `specs/overview.md` tells the build the constant is
the authoritative one. Under `none` there is no `src/constants.ts`, so the name is
the build's to declare.

## Variants

Each variant is a standalone TOML file under `variants/`, listed in order in the
manifest's `variants` key, the first of which is the default. Both are rated on
the same five domains:

- `base` — the Standard dive: a remembered fog of war, line-of-sight passive
  light, and a corridor-flooding sonar pulse, with the whole explored map drawn
  and the amber lights carrying at any distance. The reference dive.
- `kindle` — the same fog of war seen through an outer vision circle the forager
  carries, which grows as it eats. The circle reveals nothing and remembers
  nothing; it masks how much of the already-revealed maze is drawn, and beyond it
  even explored ground is dark. It ships its own `workspaces/kindle/simple-2d`
  and `workspaces/kindle/structured-2d`, because their `src/constants.ts` carries
  `KINDLE_VISION_MIN` and `KINDLE_VISION_GAIN` and their dive label differs.

Only the engine-backed project differs by variant. The engineless project holds
no game code for a variant to differ in, so every variant shares
`workspaces/none/`.

The checklist is common apart from the two points the dives genuinely disagree
on. `base` carries the whole explored map staying drawn and the amber lights
carrying at any distance; `kindle` carries the six points about its circle: what
it draws, how it grows, what it hides without forgetting, that it does not govern
the predators, that the amber lights are clipped to it, and that a flare is a
second window onto the maze.

## Assets and media

This version seeds seven sprite-sheet directories under `assets/` — the forager
(`glimmerfin`), the three predators (`lanternjaw`, `gloamfin`, `flarefish`), the
bonus drifter, the flare bloom, and the maze tileset (`trench-walls`) — each a
folder of per-frame PNGs, drawn by The Test Cabinet's own asset-generation cases.
The build renders each element from its sheet, so the art is identical across
every run and only the implementation varies. The model still designs a
conforming maze from those tiles. Everything with no sheet — the plankton, the
forager's light, the sonar wavefronts, the ink, and the whole HUD — is drawn in
code.

The case declares no reference mockups and no proof captures. The media a
reviewer looks at is produced by the validators under `validation/`, from
scenarios the case controls. Most points declare a replay: the draw-command
recording taken while the check drove the build, played back by re-issuing the
operations against a canvas, so what a reviewer scrubs is the build's own
drawing. A suite arms the recorder around the section its point is about and
disarms it the moment that section ends, so a replay is the acquisition, the
crossing, or the flare cycle, and never the arrangement that got there. A few
points declare a single image instead, where the thing being checked is one
frame: a screen's copy, a mote in the dark, the fit of the stage in its window.

Capture never decides anything. A point passes or fails on its assertions, and
the replay is what a reviewer looks at afterwards to see what the build actually
drew while it did. A failing scenario still writes what it recorded.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/end-to-end/easy/fathom/v3.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
