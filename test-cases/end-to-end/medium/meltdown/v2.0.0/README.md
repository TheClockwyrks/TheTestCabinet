# Meltdown — `v2.0.0`

This is version `v2.0.0` of the **Meltdown** test case. The implemented game is
an original open-field tower-defense game titled Meltdown: you build a maze out
of your own emitter towers to wind the surge the long way around, where every
emitter fires harder the hotter it runs but trips offline at the redline, so
holding the floor is about pacing heat as much as shaping the maze.

`meltdown` is the catalog slug for this lineage of open-field tower-defense
cases, and the game's in-fiction title. The case is inspired by classic
open-field tower defense but is not a clone of any of them — the name, the look,
the heat-as-power emitters with their per-tower redline plateau and trip, the
surface-cooling thermal blanket (towers shed heat only through radiator faces on
open air, so packed cores bake), variable tower sizes, the thermostatic Forge and
coolant Sink, the heat-averse cryo Rime, and the surge are original to The Test
Cabinet. It keeps the genre's defining hook — towers are walls and you build the
maze the surge must walk — and layers its own signature, heat-as-power, on top of
it.

## Why this case

Meltdown is a `medium` end-to-end case, and what makes it medium is the number of
systems that have to hold each other up at once: a maze that re-paths live under
a grid of multi-size rotatable footprints, a two-phase thermal model in which
every tower is coupled to its neighbours, a damage curve that plateaus at each
tower's own redline with the trip as its only failure, an economy with four
income lines, six surge types including a flyer that ignores the maze, a
twenty-wave progression stated as closed forms, five modes over three
difficulties, eight screens, and a build panel with a live inspector. None of it
is deep on its own; all of it together is a great deal to keep consistent.

## What is new in `v2.0.0`

A major bump. Three engines instead of one; a debug surface rewritten from
nothing, with no operation carrying its old signature; a rewritten and re-split
spec set; per-engine reference implementations; per-engine Vitest validator
suites deciding all 343 review items; captured baseline media per engine; and a
case showcase in place of the proof captures. `changelog.md` carries the full
entry.

## Engines

Meltdown is designed for three engines, and seeds a different project for each:

| Engine          | What the seeded project supplies                                                                                                                                                                                                                                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`          | The toolchain configuration and `index.html`, and nothing else. There is no `src/`. The build writes the runtime — the frame loop and its delta time, the canvas fit, keyboard and pointer input, audio, the overlay and the `window.__meltdown` surface — and then the game on top of it. The surface additionally carries the clock, as `setAutoStep` and `advance`.     |
| `simple-2d`     | The Simple 2D package, vendored at seed time, plus `src/constants.ts`, `src/main.ts` and a `src/game.ts` stub whose three functions throw. The build replaces the stub: `MeltdownState`, `MeltdownDebugApi`, `BACKGROUND`, and the three functions. `initialize` returns the surface beside the state as `[state, debug]`, which the engine serves from `engine.debug`.    |
| `structured-2d` | The Structured 2D package, vendored the same way, plus `src/constants.ts` and `src/main.ts` alone. `src/game.ts` is deliberately absent, so a freshly seeded workspace does not type-check. The build writes the game definition, the instance whose `initialize` returns the debug surface, the mode that holds the run and every screen, the live state, and the actors. |

The game the three projects describe is the same one, so the review items are the
same for every engine and a score recorded under one is comparable with a score
recorded under another.

## The single variant

Meltdown ships one variant, `base` (`variants/base.toml`), and nothing in the
seeded set branches on `variant.slug`. Containment, The Hundred, Deep Pockets,
Bottleneck and Sudden Death are five ways to play one game, picked from one mode
menu, sharing one floor, one heat model, one control scheme and one snapshot
shape. Every spec is therefore common and seeded for every run; the `.hbs`
templates branch on `engine.slug` alone.

## Contents

| Path                   | Seeded to run? | Purpose                                                                 |
| ---------------------- | -------------- | ----------------------------------------------------------------------- |
| `specs/`               | Yes            | The spec handed to the model, by concern.                               |
| `workspaces/`          | Yes            | The starter TypeScript project, `<engine>/`, seeded at the run root.    |
| `references/`          | No             | The authored, correct build, one directory per engine. Never seeded.    |
| `validation/`          | No             | The validator suites deciding every review item, `<engine>/`.           |
| `validation-baseline/` | No             | The baseline media, captured from each reference build.                 |
| `showcase/`            | No             | The variant's demo media and description for the catalog.               |
| `prompt.hbs`           | No             | Rendered into the model's prompt; not seeded.                           |
| `test-case.toml`       | No             | Manifest: workspaces, engines, toolchain, specs, domains, review items. |
| `variants/`            | No             | One TOML file per variant (listed in `variants`).                       |
| `description.md`       | No             | The site-facing introduction on the case's detail page.                 |
| `changelog.md`         | No             | This version's entry in the case's changelog.                           |
| `README.md`            | No             | This overview.                                                          |

The specification is split across `specs/` by concern, and every file is seeded
for every run. Each rule lives in exactly one file:

| Spec                 | Covers                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `overview.md`        | What is built, what stays as it is, the stage, the legibility table, and the toolchain commands. |
| `floor.md`           | The casing, the tile-to-stage map, the grid, and the four openings.                              |
| `mazing.md`          | Towers as walls, the step rule, the route metric, live re-pathing, and the never-seal rule.      |
| `heat.md`            | The two-phase heat model, cooling, conduction, the damage curve, and the trip as a crossing.     |
| `towers.md`          | The eight towers as data, the footprints, the radiator layouts, and the upgrade multipliers.     |
| `combat.md`          | Range, targeting, the fire clock, damage, splash, and the Rime's slow.                           |
| `building.md`        | Arming, previewing, placing, upgrading and selling, with the refund and the freshness rule.      |
| `surge.md`           | The six intruder types and what a kill and a leak are worth.                                     |
| `waves.md`           | The three phases, the wave progression, victory and loss, pausing and the speed toggle.          |
| `economy.md`         | Bounties, the wave-clear bonus, interest, the early-send bonus, and the score.                   |
| `modes.md`           | The five modes and the three difficulties, as one derived-figures table.                         |
| `controls.md`        | The pointer model, every key binding, and the Escape precedence rule.                            |
| `hud.md`             | The build panel, the shop, the inspector, and the on-floor reads.                                |
| `screens.md`         | The eight screens, their content and their navigation.                                           |
| `audio.md`           | The ten cues, the event each answers, and mute.                                                  |
| `state.md`           | What the game's state carries.                                                                   |
| `instrumentation.md` | The debug and automation surface and the diagnostics overlay.                                    |
| `showcase.md`        | The showcase the finished build ships beside its source.                                         |

`overview.md.hbs`, `controls.md.hbs`, `audio.md.hbs`, `state.md.hbs`,
`instrumentation.md.hbs` and `showcase.md.hbs` are Handlebars templates rendered
on the engine axis before they land; the rest are plain Markdown, identical under
every engine. Because the branching resolves at seed time, each seeded set reads
as one self-contained game with no alternative in view.

Under `simple-2d` and `structured-2d`, every figure the specification fixes is
exported from the seeded `src/constants.ts` under the name the specs cite, so a
spec never restates a number the project already names. Under `none` there is no
seeded constants module, and each figure is named once in a module of the build's
own.

## Assets and the look

This version has no assets and declares no reference mockups. The geometry is
pinned to the figure — the stage, the casing band, `TILE`, the tile-to-stage map,
the openings' rows and columns — and everything else about the look is the
build's. There is no palette, no typeface and no panel layout anywhere in the
specs or in `src/constants.ts`. What the specification does fix about appearance
is legibility a player depends on: an emitter's colour tracking its heat along a
ramp, a tripped tower reading apart from an online one at the same heat, radiator
faces drawn apart from plain ones, and the surge reading apart from every colour
a tower shows anywhere on its ramp. The `presentation` validators decide exactly
that, against an RGB distance and never a hex value.

## Validation

This case is validator-rated: all 343 review items carry a Vitest suite, and the
validators decide the functional rating through each item's failure cap. A
reviewer rates the run's aesthetics and may override a verdict.

`validation/` holds one project per engine, each with a suite per review item at
`<category>/<id>.test.ts`. The `none` suites drive the built site in Chromium
through `window.__meltdown`; the two engine projects run in process against the
vendored engine and reach the surface through `engine.debug`. The three run the
same scenarios and differ only in how they reach the build.

Each project carries the same spec-derived oracle beside its harness:
`thermal.ts` recomputes the two-phase heat model from the specification's own
figures, and `routes.ts` recomputes the route metric the same way, so every
thermal and pathing expectation is derived from the specs rather than from a
number the reference produced.

`validation-baseline/<engine>/<variant>/` holds the media the same suites
captured from that engine's reference build, so a reviewer sees the build's
evidence and the reference's side by side.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/end-to-end/medium/meltdown/v2.0.0/`). Each version is
self-contained and immutable once a run references it; design revisions land as
new version folders.
