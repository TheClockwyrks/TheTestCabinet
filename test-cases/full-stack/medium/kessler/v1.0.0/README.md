# Kessler — `v1.0.0`

This is version `v1.0.0` of the **Kessler** test case, a **full-stack** case. The
implemented game is an original orbital demolition arcade game titled Kessler: a
deflector rides a circular track above a central planet, batting a demolition
ball outward through three concentric rings of derelict satellites, while caught
salvage pods grant tools and any missed ball burns up below. It ships a single
`base` variant, an endless score attack over waves. On top of building the game,
the model must produce the planet and pod sprites, the ball's six-frame spin
sheet, three particle systems, and the game's thirteen cues and two music beds,
with the asset-generation tools on the run image's `PATH`.

`kessler` is the catalog slug for this lineage of orbital demolition cases, and
the game's in-fiction title (after the debris-cascade syndrome). The case is
inspired by circular block-breakers and is not a clone of any of them: the name,
the look, the fiction and the rules are original to The Test Cabinet.

## Why this case

Kessler pairs a genuinely polar simulation with a wide production pass. Every
contact is a crossing event with a direction gate — the deflector saves a ball
only as it crosses the track radius moving inward within the span, a derelict is
hit on its face or its edge by two different crossings, and a moving ring can
sweep its own edge into a ball. The deflector bounce is a four-step pipeline
(specular, english from the contact offset, an exit-angle clamp, the wave's ball
speed), every other reflection preserves speed, takes a kick from a moving ring,
and decays toward the radial, and the whole simulation is deterministic under a
seeded pod stream with pinned draw order. Around the core sit per-wave orbit and
speed formulas, five pod effects on tick-counted timers, waves, lives, and six
screens. None of it is exotic, and all of it has to be right.

The full-stack half asks for two sprite sets, a spin sheet, three
radially-symmetric particle systems played through the particle runtime, and
fifteen produced audio files — a bigger pass than the easy full-stack cases —
wired into the build during the run. A correct game with code-drawn placeholders
and handsome assets bolted to a bounce that mishandles its english both fall
short.

## Engines

Kessler is designed for three engines, and seeds a different project for each:

| Engine          | What the seeded project supplies                                                                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `none`          | The toolchain configuration and `index.html`, and nothing else. There is no `src/`. The build writes the fixed-tick loop and its clock, the canvas fit, keyboard input, audio, the overlay and the `window.__kessler` surface, and then the game on top of it.                                                                       |
| `simple-2d`     | The [Simple 2D](/engines/simple-2d/) package, vendored at seed time, plus `src/constants.ts` (every figure the specification fixes) and `src/main.ts`. The build writes `src/game.ts`. Its `initialize` returns the debug surface beside the state as `[state, debug]`.                                                              |
| `structured-2d` | The [Structured 2D](/engines/structured-2d/) package, vendored the same way, plus the same two case-owned modules (its constants also carry the level name and tag vocabulary). The build writes `src/game.ts`: the game definition, its level, its state and its actors, and the debug surface its instance's `initialize` returns. |

The collision is simulation-owned polar math on every engine — no engine
collider stands in for the crossing rules — and the asset-production pass is
common to all three. No engine supplies art or sound, so every run produces the
sprites, the particle systems and the audio with the on-`PATH` binaries against
the one `specs/assets.md` contract. Under both engines the seeded `src/game.ts`
is a stub written against types the build has yet to declare, so a freshly
seeded workspace does not type-check: that failing typecheck is the starting
point rather than a broken seed.

## The variant

Kessler ships one variant:

| Variant | The game it asks for                                                       |
| ------- | -------------------------------------------------------------------------- |
| `base`  | The endless orbital score attack through the three rings, over waves.      |

Every spec is common. The wave progression is the game's own difficulty curve
and the pod effects are in-game tools, so nothing about the game is a variant
axis; the specs branch only on the engine.

## Contents

| Path             | Seeded to run? | Purpose                                                                 |
| ---------------- | -------------- | ----------------------------------------------------------------------- |
| `specs/`         | Yes            | The spec handed to the model, by concern.                               |
| `workspaces/`    | Yes            | The starter TypeScript project, `<engine>/`, seeded at the run root.    |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.                           |
| `test-case.toml` | No             | Manifest: workspaces, engines, toolchain, specs, domains, review items. |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).                       |
| `description.md` | No             | The site-facing introduction on the case's detail page.                 |
| `changelog.md`   | No             | This version's entry in the case's changelog.                           |
| `README.md`      | No             | This overview.                                                          |

The specification is split across `specs/` by concern, and every file is seeded
for every run:

| Spec                    | Covers                                                                            |
| ----------------------- | --------------------------------------------------------------------------------- |
| `overview.md`           | What is built, the runtime, the code quality, and the commands run over it.       |
| `field.md`              | The stage, the polar mapping, every contact radius, the tick order, determinism.  |
| `deflector-and-ball.md` | The deflector, serving and launching, the bounce pipeline, and every reflection.  |
| `rings.md`              | The three rings, their derelicts, orbits, contacts, destruction, and waves.       |
| `pods.md`               | The seeded pod draw, the five kinds, and the effects they grant.                  |
| `scoring.md`            | The points, the lives, and the wave bonus.                                        |
| `screens.md`            | The six screens, their transitions, the menus, and the HUD.                       |
| `controls.md`           | The actions, the keys bound to them, and what each does on each screen.           |
| `assets.md`             | The production contract for the assets the build must make.                       |
| `instrumentation.md`    | The debug and automation surface, the snapshot, and the diagnostics overlay.      |
| `showcase.md`           | The showcase directory the finished build ships beside its source.                |

## Assets and media

This version declares no reference mockups. The polar geometry, every contact
radius, the bounce pipeline, the orbit and wave formulas, the pod draw and every
timer are fixed exactly, and the palette, the type and the look of the field and
the HUD are the build's. The produced assets — the planet and pod sprites, the
ball's spin sheet, the three particle systems, the cues and the two beds — are
made during the run with the binaries on the run image's `PATH` and committed
into the build, so `npm ci && npm run build` is self-contained and runs with the
generation binaries absent. The rings and derelicts, the deflector, the shield,
the containment field, the starfield and the HUD stay drawn in code.

## Validation

This case is on the engine format, so it is validator-rated: each review item on
the checklist is one observable behavior, cut so a validator can decide it by
posing the scenario through the instrumentation surface and reading it back, and
each carries the scoring domains its failure lowers and the failure cap it
applies.

The validator suites do not ship in this change. `validation/<engine>/` (one
Vitest project per engine, a suite per item at `<category>/<id>.test.ts`),
the reference implementations under `references/<engine>/base/`, the captured
`validation-baseline/` media, and the `showcase/` land in a later change; each
item's `validation` declaration is added with its suite. Until then the
checklist is the authored statement the suites are written to.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/full-stack/medium/kessler/v1.0.0/`). Each version is self-contained
and immutable once a run references it; design revisions land as new version
folders.
