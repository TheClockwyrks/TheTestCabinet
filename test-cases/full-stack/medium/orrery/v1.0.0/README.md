# Orrery — `v1.0.0`

This is version `v1.0.0` of the **Orrery** test case, a **full-stack** case. The
implemented game is an original machine-building puzzle titled Orrery: brass arms
stand over a bounded hex field under a celestial fiction, each arm running a
looping tape of instructions, while engraved sigils bind, wane, mirror, ascend,
conjoin, eclipse and disperse the constellations of motes the arms swing across
them. It ships a single `base` variant carrying both modes, the build's own
Campaign course and the fixed ten-challenge Extras shelf. On top of building the
game, the model must produce every sprite the field shows, the rise and set
aperture sheets, three particle systems, six cues and a seamless music bed, with
the asset-generation tools on the run image's `PATH`.

`orrery` is the catalog slug for this lineage of machine-building puzzle cases.
The case is inspired by programmable factory puzzlers and is not a clone of any
of them: the name, the look, the fiction and the rules are original to The Test
Cabinet.

## Why this case

Orrery is a simulation case first. The cycle is a fixed pipeline: fetch, drops,
grabs, a simultaneous motion sweep, then an ordered sigil phase, sets, rises, and
the completion check. Motion is rigid-body over hexes, with a multi-hold
consistency rule deciding when two arms may share a constellation and when they
tear it. Collision is a sampled sweep of eight fractions per cycle against a
fixed radius, pinned by eleven worked examples with computed distances, so a
rotation through a tight gap faults while a straight slide through the same gap
clears. The sigils are a pipeline of their own, four waves in reading order, each
reading the field as the last left it.

The second half of the case is a direct-manipulation editor of real size: a tray
measured in fixed slots, drags with legality ghosts, track laid hex by hex, a
tape panel with a cursor, deterministic scroll rules, two macros computed from an
arm's own pose history, and session-wide undo. The whole surface is driveable
through the debug API's pointer operations and real key events, and whole
machines load and read back as JSON. The campaign requirement closes the loop: a
build must design its own course and then prove every challenge solvable with
solutions its own debug surface hands over, the fixed Extras included.

The full-stack half asks for the mote, filament, sigil, instruction-glyph and
part sprites, two aperture sheets, three particle systems played through the
particle runtime, and seven produced audio files, wired into the build during the
run. A correct machine with code-drawn placeholders and a handsome sky over a
sweep that mishandles its collision samples both fall short.

## Engines

Orrery is designed for three engines, and seeds a different project for each:

| Engine          | What the seeded project supplies                                                                                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`          | The toolchain configuration and `index.html`, and nothing else. There is no `src/`. The build writes the frame loop, the canvas fit, pointer and keyboard input, audio, the overlay and the `window.__orrery` surface, and then the game on top of it.        |
| `simple-2d`     | The Simple 2D package, vendored at seed time, plus `src/constants.ts` (every figure the specification fixes) and `src/main.ts`. The build writes `src/game.ts`. Its `initialize` returns the debug surface beside the state as `[state, debug]`.              |
| `structured-2d` | The Structured 2D package, vendored the same way, plus the same two case-owned modules. The build writes `src/game.ts`: the game definition the engine drives, its mode, its state and its actors, and the debug surface its instance's `initialize` returns. |

The simulation is case-owned math on every engine — no engine collider stands in
for the sampled sweep — and the asset-production pass is common to all three. No
engine supplies art or sound, so every run produces the sprites, the sheets, the
particle systems and the audio with the on-`PATH` binaries against the one
`specs/assets.md` contract. Under both engines the seeded `src/game.ts` is a stub
written against types the build has yet to declare, so a freshly seeded workspace
does not type-check: that failing typecheck is the starting point rather than a
broken seed.

## The variant

Orrery ships one variant:

| Variant | The game it asks for                                                          |
| ------- | ----------------------------------------------------------------------------- |
| `base`  | The whole machine-building game, the build's own Campaign and the ten Extras. |

Every spec is common. Campaign and Extras are modes the player picks from the
title menu rather than variant axes, so both mode specs are seeded into every
run; the specs branch only on the engine.

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

| Spec                 | Covers                                                                          |
| -------------------- | ------------------------------------------------------------------------------- |
| `overview.md`        | What is built, the runtime, the code quality, and the commands run over it.     |
| `field.md`           | The hex geometry, the coordinates, the bounds, and the fifteen mote types.      |
| `parts.md`           | The mechanisms, their costs, their poses, and the rules that place them.        |
| `sigils.md`          | Every sigil's footprint and effect, and the order the wave applies them in.     |
| `instructions.md`    | The instruction set, the looping tapes, and the two pose-history macros.        |
| `simulation.md`      | The cycle pipeline, simultaneous motion, the torn rule, collision, and metrics. |
| `controls.md`        | The pointer and key input and what each does on each screen.                    |
| `editor.md`          | The tray, the drags, the track, the tape panel, focus routing, and undo.        |
| `formats.md`         | The challenge and solution documents, as they load and read back.               |
| `challenges.md`      | The ten fixed Extras challenges.                                                |
| `modes/campaign.md`  | The course the build designs and the reference solutions it ships.              |
| `modes/extras.md`    | The Extras shelf and how it is played.                                          |
| `state.md`           | The game's state, and the shape a snapshot reports.                             |
| `instrumentation.md` | The debug and automation surface, the snapshot, and the diagnostics overlay.    |
| `ui.md`              | The screens, the HUD, and the audio cues.                                       |
| `assets.md`          | The production contract for the art and sound the build must make.              |

## Assets and media

This version declares no reference mockups. The hex geometry, the rosters, the
rules, the ten Extras and the campaign's obligations are fixed exactly, and the
palette, the type and the look of the sky are the build's. The produced assets —
the mote, filament, sigil, instruction and part sprites, the two aperture sheets,
the three particle systems, the six cues and the music bed — are made during the
run with the binaries on the run image's `PATH` and committed into the build, so
`npm ci && npm run build` is self-contained and runs with the generation binaries
absent. `specs/assets.md` also lists what stays drawn in code.

## Validation

This case is on the engine format, so it is validator-rated: each of the 1115
review items across 15 categories is one observable behavior, cut so a validator
can decide it by posing the scenario through the instrumentation surface and
reading it back, and each carries the scoring domains its failure lowers and the
failure cap it applies.

The validator suites and the reference implementations do **not** exist yet.
Every item already declares its suite path in its `validation` key, at
`<category>/<id>.test.ts`, so the case does not resolve until
`validation/<engine>/` ships one Vitest project per engine holding those suites.
`references/<engine>/base/` and the variant's `[reference_implementation]` table
land in the same change, and are what `tcab capture-baselines` drives to
synthesize the baseline half of every item's validation media.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/full-stack/medium/orrery/v1.0.0/`). Each version is self-contained
and immutable once a run references it; design revisions land as new version
folders.

## Authoring notes

- The collision examples' distances were computed from a sampled sweep at
  `t = k/8`, `HEX_PITCH` 48, and the threshold `2 * MOTE_COLLIDE_R` = 38.
  Changing any of those constants means recomputing every example.
- The case fixes the interaction geometry of the field, the tray slots, and the
  tape cells, and leaves appearance to the build, so validators can drive the
  editor through emulated input while every build looks like its own game.
