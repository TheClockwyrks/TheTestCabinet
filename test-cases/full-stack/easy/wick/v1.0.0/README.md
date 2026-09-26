# Wick — `v1.0.0`

This is version `v1.0.0` of the **Wick** test case, a **full-stack** case. The
implemented game is an original survival game titled Wick: a lamplighter alone
in a moth-choked city at night, who only ever moves while the tools on the lamp
fire on their own, against a ten-minute night that ends at dawn or when the
light goes out. It ships a single `base` variant, the whole night. On top of
building the game, the model must produce the lamplighter's sprites, thirteen
enemy walk cycles, the weapon effects, twenty-seven item icons, a ground tile,
fourteen cues and a looping music bed, with the asset-generation tools on the
run image's `PATH`.

`wick` is the catalog slug for this lineage of survival cases, and the game's
in-fiction title. The case is inspired by auto-firing survival games and is not
a clone of any of them: the name, the look, the fiction and the roster are
original to The Test Cabinet.

## Why this case

Wick is breadth, not depth. Every rule is a table row or a one-line formula:
there is no physics to tune, no opponent to model, and no solver. Ten base
weapons each carry their own targeting and shape and an eight-row level table,
ten passives are single terms in ten derived-stat formulas, six evolutions
transform a maxed weapon when a chest opens beside the right passive, thirteen
enemies carry a row apiece across three behaviors, and a director walks a
twenty-window schedule with seven scripted events over it. What the case
measures is whether a build carries all of that through to the end without
dropping or blurring a row, and the checklist is cut to match: one item per
weapon table row, per passive formula, per evolution recipe, per enemy, per
spawn window, per screen, per cue, and per produced asset group.

A render-free, fixed-timestep core is what makes any of it decidable. The
simulation advances on a fixed tick, and the timer rule of `specs/world.md`
puts a timer set to `s` seconds due exactly `round(s × TICK_HZ)` ticks later,
so a cooldown or a re-hit lands on an exact tick. A scenario poses the moment
it wants through the debug surface, and where the game draws at random the
surface poses the draw's outcome: which enemy spawns where, which offers are
dealt, where a puddle lands, which target a strike picks, which item a chest
levels, which way a swarm comes, and whether a kill drops bread or a draft. A
pose fixes only what the game would have drawn; every hit, kill, drop and
evolution a validator reads comes from stepping the real systems.

The full-stack half asks for a wide production pass — a walk cycle, thirteen
enemy sheets, the weapon effects, the gems and pickups, a tiling ground,
twenty-seven icons, fourteen cues and a bed that loops without a seam — wired
into the build during the run. A correct roster over code-drawn placeholders and
a handsome night whose Sconce never comes back both fall short.

## Engines

Wick is designed for three engines, and seeds a different project for each:

| Engine          | What the seeded project supplies                                                                                                                                                                                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`          | The toolchain configuration and `index.html`, and nothing else. There is no `src/`. The build writes the fixed-tick loop and its clock, the canvas fit, keyboard input, audio with its two looping cues, the overlay and the `window.__wick` surface, and then the game on top of it.                                                          |
| `simple-2d`     | The [Simple 2D](/engines/simple-2d/) package, vendored at seed time, plus `src/constants.ts` (every figure the specification fixes) and `src/main.ts`. The build writes `src/game.ts`. Its `initialize` returns the debug surface beside the state as `[state, debug]`.                                                                        |
| `structured-2d` | The [Structured 2D](/engines/structured-2d/) package, vendored the same way, plus the same two case-owned modules (its constants also carry the level name and tag vocabulary). The build writes `src/game.ts`: the game definition, its level, its mode, its state and its actors, and the debug surface its instance's `initialize` returns. |

Every contact is the simulation's own circle and rectangle math over the state
on all three engines, so no engine collider stands in for the rules
`specs/world.md` and `specs/weapons.md` fix. The asset-production pass is common
to all three: no engine supplies art or sound, so every run produces the
sprites, the icons, the cues and the bed with the on-`PATH` binaries against the
one `specs/assets.md` contract. Under both engines the seeded `src/game.ts` is a
stub written against types the build has yet to declare, so a freshly seeded
workspace does not type-check: that failing typecheck is the starting point
rather than a broken seed.

## The variant

Wick ships one variant:

| Variant | The game it asks for                                                |
| ------- | ------------------------------------------------------------------- |
| `base`  | The whole night: every weapon, passive, and enemy, through to dawn. |

Every spec is common. The roster is content inside every build rather than a
variant axis, so nothing in the seeded set branches on the variant; the only
axis the specs branch on is `engine.slug`.

## Contents

| Path             | Seeded to run? | Purpose                                                                 |
| ---------------- | -------------- | ----------------------------------------------------------------------- |
| `specs/`         | Yes            | The spec handed to the model, by concern.                               |
| `workspaces/`    | Yes            | The starter TypeScript project, `<engine>/`, seeded at the run root.    |
| `references/`    | No             | The authored, correct build, `<engine>/<variant>/`. Never seeded.       |
| `validation/`    | No             | The validator suites deciding every review item, `<engine>/`.           |
| `showcase/`      | No             | The variant's catalog media and description, plus its capture driver.   |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.                           |
| `test-case.toml` | No             | Manifest: workspaces, engines, toolchain, specs, domains, review items. |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).                       |
| `description.md` | No             | The site-facing introduction on the case's detail page.                 |
| `changelog.md`   | No             | This version's entry in the case's changelog.                           |
| `README.md`      | No             | This overview.                                                          |

The specification is split across `specs/` by concern, and every file is seeded
for every run:

| Spec                 | Covers                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `overview.md`        | What is built, the runtime, the code quality, and the commands run over it.                                          |
| `world.md`           | The plane, the camera, the order of a tick, the timer rule, the lamplighter, contact, the endings, gems and pickups. |
| `weapons.md`         | The rules every weapon shares, and the ten base weapons with their level tables.                                     |
| `evolutions.md`      | The six recipes, what a chest does, and the evolved rows.                                                            |
| `passives.md`        | The ten passives and the derived stats their levels feed.                                                            |
| `progression.md`     | Experience, levels, slots, the offer pool, and the two overlays.                                                     |
| `enemies.md`         | The thirteen enemies, their behaviors, and the spawn director with its events.                                       |
| `controls.md`        | The eight actions, the keys bound to them, what each screen reads, and the pointer.                                  |
| `state.md`           | The shape of the state the game carries.                                                                             |
| `instrumentation.md` | The debug and automation surface, the driver switches, the snapshot, and the overlay.                                |
| `ui.md`              | The nine screens, the HUD, the almanac, the descriptions, the audio cues, and the two loops.                         |
| `assets.md`          | The production contract for the assets the build must make.                                                          |

`world.md`, `weapons.md`, `evolutions.md`, `passives.md`, `progression.md` and
`enemies.md` are plain Markdown, identical under every engine. The other six are
`.hbs` and branch on `engine.slug` alone, for what the build is handed and what
it must write.

## Assets and media

This version declares no reference mockups. Every figure a validator reads is
fixed exactly — the tick, the timer rule, each weapon's table, each passive's
term, each enemy's row, the schedule and the events — and the palette, the font,
the sprite artwork and the animation timing are the build's. What a validator
reads of the drawing is only what the specs fix: the thirteen silhouettes told
apart, an evolved effect distinct from its base, the gems told apart by size,
the copy each screen names, and the HUD over the world. How any of it looks is
the presentation domain's aesthetic rating.

The sprites, the sheets, the icons, the fourteen cues and the music bed are
produced during the run with the binaries on the run image's `PATH` and
committed into the build, so `npm ci && npm run build` is self-contained and
runs with the generation binaries absent. The ground is the produced tile
repeated in world space; the HUD's bars, pips, clock and slot frames, every
menu, overlay and screen and all of their text, and the debug overlay stay drawn
in code.

## Validation

This case is validator-rated: every item on the checklist carries a Vitest
suite, and the validators decide the functional rating through each item's
failure cap. A reviewer rates the run's aesthetics and may override a verdict.

`validation/` holds one project per engine, `validation/none/`,
`validation/simple-2d/` and `validation/structured-2d/`, each with a suite per
review item at `<category>/<id>.test.ts`, and every item on the checklist names
that path in its `validation` key. The `none` suites serve `dist/` and drive the
built site in Chromium through `window.__wick`, over the shared engineless kit
in `@clockwyrks/case-harness`; the two engine projects run in process against
the vendored engine, step a scripted clock frame by frame, and reach the
surface through `engine.debug`. The three run the same scenarios and differ only
in how they reach the build. Every threshold traces to a figure or rule in the
seeded specs, with the one-tick tolerance the timer rule implies, and never to a
reference.

This version's `validation-baseline/<engine>/base/` in the `cold-storage`
submodule holds the media the same suites captured from that engine's reference
build, so a reviewer sees the build's evidence and the reference's side by side.

`showcase/base/` is the variant's catalog media: a replay of one sustained
stretch of a real night and two stills from that same take, recorded from the
`structured-2d` reference by the driver in `showcase/capture/`.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/full-stack/easy/wick/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version
folders.
