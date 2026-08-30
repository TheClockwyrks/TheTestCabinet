# Spectra — `v2.0.0`

This is version `v2.0.0` of the **Spectra** test case. The implemented game is an
original fixed-position formation shooter: a lone resonator-fighter holds a lane
along the bottom of the stage while a swarm of crystalline drones flies in on
sweeping paths, assembles into a swaying formation overhead, and peels off to
dive. The cannon is tuned to one of two **spectral bands**, and that band is also
the shield — a shot only destroys a drone of the matching band, enemy fire of your
own band is absorbed, and fire of the other band is lethal. The swarm always holds
both bands at once, so the drone you want to shoot and the bullets you must
survive pull the same choice in opposite directions.

`spectra` is the catalog slug for this lineage of formation-shooter cases, and the
game's in-fiction title. The case is inspired by classic formation-shooter arcade
games but is not a clone of any of them: the name, the look, the two-band polarity
system, the three drones, the resonance discharge and the Prism's spectral
inversion are original to The Test Cabinet. It deliberately drops the genre's two
most recognizable hooks — the tractor-beam capture and the double fighter — because
survival here is about reading the field's two bands and flipping at the right
instant, not about power-ups.

A model is handed a configured TypeScript project, the game's sprite art and its
particle burst, and the specification, and builds the game inside that project.
How much of the build the project hands over depends on the engine the run
selects.

## Why this case

Spectra is a large build for an `easy` case, and its size is breadth rather than
depth. There is no physics beyond straight-line integration, no opponent to model,
and nothing tuned by feel: every rule is stated over one `1280 x 720` stage. What
the case asks for is many exact rules holding at once — an effective-band
definition applied through two independent swaps; three drone kinds that each
probe that definition a different way; a wave that flies in as staggered groups,
assembles, sways as one body and dives off its own clock; a resonance meter and a
discharge that takes some rosters and spares others; a stage ladder with challenge
flyovers and four scaling formulas; seven screens; a HUD; and nine audio cues. A
build that is nearly right in many places is told apart from one that is right.

## Engines

The case supports three engines and seeds a different project for each, which is
what the manifest's `[workspaces]` table is for:

| Engine          | What the seeded project supplies                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `none`          | The toolchain configuration, `index.html`, and the art and particle system under `assets/`. There is no `src/`: the build writes the game and the runtime beneath it — the frame loop and its delta time, the canvas fit, keyboard input, audio, image loading, the overlay and the `window.__spectra` surface. The surface additionally carries the clock, because nothing outside the build owns it.                                     |
| `simple-2d`     | The [Simple 2D](/engines/simple-2d/) package, vendored at seed time, plus `src/constants.ts` and `src/main.ts` and a `src/game.ts` stub. The build writes `src/game.ts`: `SpectraState`, the debug surface `specs/instrumentation.md` specifies, `BACKGROUND`, and the three functions. Its `initialize` returns the surface beside the state as `[state, debug]`, which the engine serves from `engine.debug`.                            |
| `structured-2d` | The [Structured 2D](/engines/structured-2d/) package, vendored the same way, plus `src/constants.ts` and `src/main.ts`. `src/game.ts` is deliberately absent from the seed, so the first `tsc` fails on the missing module. The build writes the `GameDefinition`, the instance whose `initialize` returns the debug surface, the mode whose `gameStateClass` is the live `SpectraState`, and the actors the field is drawn and driven by. |

Spectra runs in **one** world for the whole session under `structured-2d`: every
screen is a value of the state's `screen` field rather than a level of its own, so
the wave survives a stage advance without the world being rebuilt.

The game all three projects describe is the same one, so the review items are the
same under any engine and a score recorded under one is comparable with a score
recorded under another. The specs and the validators branch where the deliverable
differs, and nowhere else.

## The two variants

| Variant    | The mode | What a mismatched shot does                                                                                                                                                           |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base`     | Sortie   | Nothing. The bullet is consumed and the drone is untouched — the shot is simply wasted.                                                                                               |
| `overload` | Overload | It charges the drone. The third charge overloads it into a reaction that differs by kind: a Shard plunges, a Flux flips and sprays, a Prism bursts both bands and may grow the swarm. |

That is the whole of the difference, and only `specs/mode.md.hbs` states it —
`specs/state.md.hbs` and `specs/instrumentation.md.hbs` branch on the variant for
what it implies (the drone's `charge` field and `setDroneCharge`), and nothing
else in the seeded set mentions the sibling mode. The three drone kinds are not
variants and neither are the stages: a variant is a difference in the game a run
is asked to build, and those are what one build already contains.

## Contents

| Path                   | Seeded to run? | Purpose                                                                   |
| ---------------------- | -------------- | ------------------------------------------------------------------------- |
| `specs/`               | Yes            | The spec handed to the model, by concern.                                 |
| `assets/`              | Yes            | The four sprites and the drone-burst particle system the game draws from. |
| `workspaces/`          | Yes            | The starter TypeScript project, seeded at the run root.                   |
| `prompt.hbs`           | No             | Rendered into the model's prompt; not seeded.                             |
| `references/`          | No             | The authored, correct build, per engine and variant. Never seeded.        |
| `validation/`          | No             | The validator suites deciding every review point, `<engine>/`.            |
| `validation-baseline/` | No             | The baseline media, captured from each reference build.                   |
| `showcase/`            | No             | Each variant's demo media and description for the catalog.                |
| `test-case.toml`       | No             | Manifest: workspaces, engines, toolchain, specs, domains, review items.   |
| `variants/`            | No             | One TOML file per variant (listed in `variants`).                         |
| `README.md`            | No             | This overview.                                                            |

## Versioning

This case follows semantic versioning per version folder
(`test-cases/end-to-end/easy/spectra/v2.0.0/`). Each version is self-contained and
frozen once a run references it; design revisions land as new version folders.
`v1.0.0` stays exactly where it is.
