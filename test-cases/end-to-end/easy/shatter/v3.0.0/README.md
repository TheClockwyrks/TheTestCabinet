# Shatter — `v3.0.0`

This is version `v3.0.0` of the **Shatter** test case. The implemented game is an
original space-rock shooter: inertial flight on a wrap-around field, rocks that
split when shot, escalating waves, and an enemy saucer, all built around a
gravity well. A star fixed at the centre of the field pulls every rock and every
shot, the ship and the saucer fly free of the pull, and any rock the star
swallows re-appears from the field's edge.

`shatter` is the catalog slug for this case, and the game's in-fiction title. The
name, the look, and the central gravity-well mechanic are original to The Test
Cabinet and not a clone of any existing game.

A model is handed a configured TypeScript project and the specification, and
builds the game inside that project. How much of the build the project hands over
depends on the engine the run selects.

This is a major bump, because every axis of the case changes: three engines
instead of one, a rewritten debug surface with no operation carried over
unchanged, a rewritten and re-split spec set, per-engine per-variant reference
implementations, per-engine Vitest validator suites in place of the browser
`.mjs` drivers, per-variant showcases in place of the proof captures, and no
seeded palette and no reference mockups. See `changelog.md` for the full upgrade.

## Engines

The case supports three engines and seeds a different project for each, which is
what the manifest's `[workspaces]` table is for:

| Engine | What the seeded project supplies |
| --- | --- |
| `none` | The toolchain configuration and `index.html`. There is no `src/`: the model writes the game and the runtime under it, meaning the frame loop and its fixed-step accumulator, the canvas fit, the keyboard, the audio, the overlay and the `window.__shatter` surface. |
| `simple-2d` | The [Simple 2D](/engines/simple-2d/) package, vendored at seed time, plus `src/constants.ts`, `src/main.ts`, and a `src/game.ts` stub whose three functions throw. The model writes that module: `ShatterState`, the debug surface `specs/instrumentation.md` specifies, and the three functions. Its `initialize` returns the surface beside the state as `[state, debug]`, which the engine serves from `engine.debug`. The engine holds the state by value: `update` is handed it read-only (`DeepReadonly<ShatterState>`) and returns the next state, `render` is handed that state read-only, and the surface's poses take the state the same way. |
| `structured-2d` | The [Structured 2D](/engines/structured-2d/) package, vendored the same way, plus `src/constants.ts` and `src/main.ts`. Its constants also name the level. `src/game.ts` is deliberately absent and `src/main.ts` imports it, so the first type-check on a fresh checkout fails by design. The model writes it: the `GameDefinition` the engine drives, the game mode that holds the screens and the rules, the actors and components the field is drawn by, the controller the ship is flown through, the debug surface its instance's `initialize` returns, and the `BACKGROUND` color `src/main.ts` hands the engine. |

Shatter runs in one world for the whole session under `structured-2d`: every
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
| `prompt.hbs`           | No             | Rendered into the model's prompt; not seeded.                                                        |
| `validation/`          | No             | The case's Vitest validators, one project per engine (`<engine>/`).                                  |
| `references/`          | No             | The authored, correct build, `<engine>/<variant>/`. Never seeded.                                    |
| `validation-baseline/` | No             | The validators' media captured against the reference, `<engine>/<variant>/`, shown beside a run's.   |
| `showcase/`            | No             | Curated demo media per variant, captured from the reference build by the drivers under `capture/`.   |
| `test-case.toml`       | No             | Manifest: workspaces, engines, toolchain, specs, domains, review items.                              |
| `variants/`            | No             | One TOML file per variant (listed in `variants`).                                                    |
| `description.md`       | No             | The site-facing introduction on the case's detail page.                                              |
| `changelog.md`         | No             | What changed from `v2.0.1`.                                                                          |
| `README.md`            | No             | This overview.                                                                                       |

There is deliberately no `reference/`, no `reference-impl/`, no `specs/proof.md`
and no `assets/`. This version declares no `[[reference]]`, no `[[proof]]` and no
`[[check]]`, every piece of evidence a reviewer sees is captured by this case's
own validators, and every body on the field is drawn in code.

The specification is split across `specs/` by concern, and every file is seeded
for every variant and every engine:

- `overview.md` — the premise, the requirements, the field's coordinate system,
  the five screens, and what a player reads at a glance.
- `field.md` — the wrapping field, the seam, and the star at its centre.
- `gravity.md` — the pull law and which bodies it acts on.
- `simulation.md` — the fixed timestep, the order of work inside one tick, and
  seeded randomness.
- `ship.md` — the ship and how it flies.
- `weapons.md` — what the ship shoots.
- `rocks.md` — the three sizes, the split ladder, and how the star recycles them.
- `saucer.md` — the enemy saucer's cadence, movement and fire.
- `collision.md` — every impact and what it does.
- `progression.md` — lives, respawns, and the wave loop.
- `scoring.md` — every score figure and the extra ship.
- `controls.md` — the keys.
- `ui.md` — the screens, their menus, the HUD, and the wave banner.
- `audio.md` — the six cues and the mute toggle.
- `state.md` — the shape of the observable state.
- `instrumentation.md` — the debugging and automation surface over it, and the
  debug overlay.
- `showcase.md` — the player-facing description and captured carousel the
  finished game ships beside its source.

Most are `.hbs` templates rendered before they land, on two axes. `variant.slug`
selects the rules of the game, inside `overview.md.hbs`, `gravity.md.hbs`,
`weapons.md.hbs`, `rocks.md.hbs`, `collision.md.hbs`, `controls.md.hbs`,
`ui.md.hbs`, `state.md.hbs` and `instrumentation.md.hbs`. `engine.slug` selects
what the build is handed and what it writes, inside `overview.md.hbs`,
`simulation.md.hbs`, `controls.md.hbs`, `audio.md.hbs`, `state.md.hbs`,
`instrumentation.md.hbs` and `showcase.md.hbs`. The branching resolves at seed
time, so each seeded set reads as one self-contained game with no cross-variant
and no cross-engine language.

Under an engine that seeds one, every figure the specification fixes is exported
from the seeded `src/constants.ts` under the name the specs cite, so a spec never
restates a number the project already names. Under `none` there is no
`src/constants.ts`, so the specs state the figures themselves and the build names
them.

## Variants

Each variant is a standalone TOML file under `variants/`, listed in order in the
manifest's `variants` key, the first of which is the default. Both are the same
single game, rated on the same four domains, `gravity`, `flight`, `arcade` and
`presentation`, and neither declares a domain of its own.

- `base` — the endless arcade game: a rock is destroyed by a single hit and the
  ship carries only its gun. It adds no review point of its own, so a base run is
  rated on the 207 common points. The reference ruleset.
- `warhead` — the same game with armored rocks, so a Large takes three hits, and
  a homing torpedo: one guided munition on a ten-second recharge that flies true
  through the well and destroys any rock outright, blasting its fragments outward
  far harder than the gun does. It adds 47 points, so a warhead run is rated on
  254.

Only the engine-backed project differs by variant, because its `src/constants.ts`
carries the armor and torpedo figures and binds the torpedo key. The engineless
project holds no game code for a variant to differ in, so both variants share
`workspaces/none/`.

## Media

The case declares no reference mockups and no proof captures. The media a
reviewer looks at is produced by the validators under `validation/`, from
scenarios the case controls, and the same suites run against each reference build
to produce the baseline it is shown beside. Capture never decides anything: a
point passes or fails on its assertions, and the recording is what a reviewer
looks at afterwards to see what the build actually drew while it did. A failing
scenario still writes what it recorded.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/end-to-end/easy/shatter/v3.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
