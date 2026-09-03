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
| `description.md`       | No             | The site-facing introduction on the case's detail page.                   |
| `changelog.md`         | No             | This version's entry in the case's changelog.                             |
| `README.md`            | No             | This overview.                                                            |

## The specification

The specification is split across `specs/` by concern, and every file is seeded
for every run. Each rule lives in exactly one file.

| Spec                 | Covers                                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `overview.md`        | What is built, what stays as it is, the `1280 x 720` stage and the center convention, the code quality, the commands run over the finished repository, and the legibility table.              |
| `field.md`           | The two HUD strips and the play field between them, the ship's lane and its clamp, the formation slot grid and the sway, where a drone enters and a bullet leaves, and the starfield.         |
| `simulation.md`      | How a frame advances: per-second rates integrated against the frame's delta time, the sub-step ceiling and the order a sub-step resolves in, the one seeded generator, and the contact model. |
| `bands.md`           | The two bands and what a band decides: the effective band and the swaps that produce it, match-to-destroy, the dual-use shield, the flip and its lockout, and the spectral inversion.         |
| `ship.md`            | The ship's footprint and half-extent, how it moves and stops, where a shot spawns and how fast it climbs, the fire interval and the bullet cap, and what blocks firing.                       |
| `resonance.md`       | What fills the meter and by how much, that it caps, does not decay and survives a death, when a discharge is available, and what the burst takes and what it spares.                          |
| `swarm.md`           | How any drone behaves: the four phases, the staggered entrance, the formation hold and the sway, the wave's dive clock, where a diver fires, and what a standard wave holds.                  |
| `drones.md`          | The fixed-band Shard, the Flux's held window and shimmer, and the Prism's two layers, its escort, its two-band burst and the inversion it triggers at the bottom.                             |
| `stages.md`          | The stage sequence, the level-clear rule stated as a moment, the challenge flyover, and the four scaling formulas with their caps and floors.                                                 |
| `progression.md`     | The starting lives, what costs one, the ready hold and the respawn, the extra life and the latch that pays it once, and the game over.                                                        |
| `scoring.md`         | Every score figure the game pays, including what a drone destroyed out of formation is worth.                                                                                                 |
| `mode.md`            | The playable mode: what a mismatched shot does to the drone it hits, and, under Overload, the telegraph, the three overload reactions and the tenth cue.                                      |
| `controls.md`        | Every action the game answers to and the keys bound to it, menu navigation and confirm, back, pause, mute, and the overlay toggle.                                                            |
| `ui.md`              | The seven screens and what each shows, the five HUD readouts, the mute indicator and the inversion overlay, and the audio cues with the mute requirement.                                     |
| `assets.md`          | The four PNGs, which band-state each depicts, the ring and diamond glyph convention, how the other band-state is derived, and the drone-burst and how it is played.                           |
| `state.md`           | What the game's state carries, in the shape the selected engine holds it in.                                                                                                                  |
| `instrumentation.md` | The deterministic core, every operation of the debug and automation surface, the world gates and the faculty switches, the snapshot shape, and the debug overlay.                             |
| `showcase.md`        | The player-facing description and captured carousel the finished game ships beside its source.                                                                                                |

`field.md`, `simulation.md`, `bands.md`, `ship.md`, `resonance.md`, `swarm.md`,
`drones.md`, `stages.md`, `progression.md` and `scoring.md` are plain Markdown,
identical under every engine and every variant. `overview.md.hbs`,
`controls.md.hbs`, `ui.md.hbs`, `assets.md.hbs`, `showcase.md.hbs`,
`state.md.hbs`, `instrumentation.md.hbs` and `mode.md.hbs` are Handlebars
templates rendered before they land. Because the branching resolves at seed time,
each seeded set reads as one self-contained game with no alternative in view.

Under `simple-2d` and `structured-2d`, every figure the specification fixes is
exported from the seeded `src/constants.ts` under the name the specs cite, and
`specs/overview.md` tells the build that the constant is the authoritative one.
Under `none` there is no seeded constants module, and each figure is stated in the
specs alone.

## Assets and media

This version seeds four `PNG` sprites — the ship, the Shard, the Flux and the
Prism — and one particle system, `drone-burst.json`, played when a drone pops
through the `@test-cabinet/particle-runtime` package the workspace already depends
on. The sprites are the finished art produced by The Test Cabinet's own
asset-generation cases, and each carries one band-state, from which
`specs/assets.md` states how the other is derived. Every build renders the game
from the same art and differs only in the code around it, which is what makes two
runs of this case comparable to look at. Everything with no sprite — the bullets,
the discharge wave, the inversion, the starfield, the HUD and every screen — is
drawn in code.

The case declares no reference mockups and no proof captures. The media a
reviewer looks at is produced by the validators under `validation/`, from
scenarios the case controls, and the same suites run against each engine's
reference build to produce the baseline it is shown beside.

## Validation

This case is validator-rated: every point on the checklist carries a Vitest
suite, and the validators decide the functional rating through each point's
failure cap. A reviewer rates the run's aesthetics through the four domains and
may override a verdict.

`validation/` holds one project per engine, `validation/none/`,
`validation/simple-2d/` and `validation/structured-2d/`, each with a suite per
review point at `<category>/<id>.test.ts`. The `none` suites drive the built site
in headless Chromium through `window.__spectra`, with a page-injected 2D-context
recorder for the draws and an injected audio shim for the cues; the two engine
projects run in process against the vendored engine, standing it up over an
`@napi-rs/canvas` canvas and a clock of their own and reaching the surface
through `engine.debug`. The three run the same scenarios and differ only in how
they reach the build.

Every scenario poses a world holding only what its point is about. The shared
harness's `startPosed` empties the drones, the bullets and the bursts, turns off
the three world gates — the wave's own entry, the dive launcher, and the ship's
contact test — and opens a live wave, and the point then adds back exactly the
entities its requirement concerns, holding each drone's own faculties (its
travel, its oscillation, its fire) so nothing else in the scenario can move. An
empty wave is safe because a stage clears on the moment its last drone is
destroyed rather than on a predicate over an empty field, which
`stages.empty-wave-does-not-clear` is what holds a build to. Every expected value
a suite asserts comes from a figure the specs fix, never from a reference build.

### Where the figure a suite asserts comes from

Every figure a suite asserts is transcribed from the specification into
`validation/<engine>/constants.ts` and imported from `"../constants"`. That file
is the only one in a validator project permitted to reach into the build at all,
and only for a value the specification genuinely leaves to the build to pick.

A suite that read its figure back out of the build's own seeded
`src/constants.ts` would reduce its check to "does the build do what the build
says it does". A build is free to seed that module untouched and run its
simulation off a figure of its own — flying the swarm at `66` where the
specification fixes `60` — and both sides of such a comparison then come from the
same wrong number, so the check passes. The same holds for a formula: a build can
ramp its stages off `1 + 0.06 * stage` where `specs/stages.md` says
`1 + 0.06 * (stage - 1)`, which is why the four stage RAMPS are restated on the
validator's side too, in `constants.ts` beside the scalars.

`harness.ts` is the one other file that names a build module, and only the entry
(`../src/game`), to stand the build up so a scenario can be posed in it. The
`none` project names none at all: it drives a built site through
`window.__spectra`, and reads every figure from `validation/none/constants.ts`.

**The rule is a gate, not a convention.** The project's `eslint.config.js` — the
same file the seeded workspace carries, run by `npm run lint` at the repository
root — holds `validation/**/*.ts` to it as soon as the tree is staged there. An
import, a re-export, a `require` or a dynamic `import()` reaching `src/` is an
error naming the file; `harness.ts` may name the build's entry and nothing else;
and `validation/constants.ts`, exempt from the import rule, still may not pass a
whole build module on with `export *`.

For the same reason none of the four `stages/scaling-*` points is decided by a
RATIO between two stages: a ramp one step out shifts both stages by very nearly
the same factor, so the error cancels in the ratio whatever band is put around
it. Each leg is read absolutely, against the figure the specification fixes for
its own stage, and the two points whose quantity is drawn or sampled rather than
exact carry a second, exact reading beside the measured one — the Flux hold
probes `shimmer` either side of the stated boundary, and the dive gap brackets a
hundred drawn gaps against `[DIVE_GAP_MIN, DIVE_GAP_MAX] * diveGapScale(7)` by
posing the wave's own dive clock either side of the window.

`validation-baseline/<engine>/<variant>/` holds the media the same suites captured
from that engine's reference build of that variant, so a reviewer sees the run's
evidence and the reference's side by side.

### One suite tree, two variants

`validation/<engine>/` is one tree per engine, shared by both variants: the
`sortie/` suites run only under `base` and the `overload/` suites only under
`overload`, and which of them a run executes is decided by the variant's own
`validation` entries in `variants/*.toml`.

Overload's own five figures — `OVERLOAD_AT` and its siblings — are seeded into the
**overload** workspace's `src/constants.ts` alone, and the `overload/` suites do
not read them from there. Like every other asserted figure they are transcribed
into `validation/<engine>/constants.ts`, so the whole tree type-checks against
either variant's build, on any engine:

```sh
npx tsc --noEmit -p validation/tsconfig.json    # from a build's root
```

### Three captures move between runs

`tcab capture-baselines` writes `1710` files across the six engine/variant
targets: `1599` stills and `111` recorded replays. Seventeen of the stills are
taken off a clock rather than off a posed frame, so two runs of the command over
unchanged code write different bytes for them, and the committed baseline for
each is one sample rather than a fixed picture. They are three outputs:

| Output                                         | Targets | Why it moves                                                                                                                                      |
| ---------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `controls.overlay-backquote__overlay`          | 6       | The panel carries a frame-time reading measured on the host that ran it: the engine's own line under an engine, the build's `dt` under `none`.    |
| `instrumentation.advances-in-real-time__after` | 6       | The point's whole subject is a second of real time under the engine's own loop, so what has moved by the still is whatever that second delivered. |
| `instrumentation.overlay__overlay`             | 5       | The same panel as the first, over a posed field.                                                                                                  |

None of the three is worth posing away. One of the points measures what a build
does with real time, and the other two open a panel whose own heading reports
the frame it was drawn on; a still taken off a posed frame would show something
none of them asserts.

`audio.no-autoplay__loaded` used to be a fourth. It is not any more: that point
reads a fixed number of driven frames and winds the build's own timers on rather
than sitting through a stretch of the wall clock, so its still is the same
picture on every host and any movement in it is the build's.

The churn is bounded and it is all there is. Three captures of the same code —
the committed one and two run back to back — differ pairwise in 14, 17 and 18 of
those nineteen files and in nothing else, and the deltas within a file run from
6 to 2291 pixels of the 921600 in a frame, inside the panel's text band or on
one moving entity. The other 1580 stills and all 111 replays are byte-identical
across all three.

So a recapture that leaves only those nineteen files dirty has changed nothing
and is not worth committing. One that moves anything else has changed the
picture a reviewer is shown, and is.

## Scoring

A run is rated on four domains — `polarity` (the two bands, the shield, the
discharge and the inversion), `swarm` (the entrances, the formation, the dives
and the three drones), `arcade` (the ship, the stages, the lives, the scoring and
the screens) and `presentation` (the screens, the HUD, the art and the audio) —
and its overall functional rating is the worst of the four. The checklist is
`269` points on a base run and `287` on an overload run: fifteen categories common
to both, plus one category the variant declares. Each point names the domains its
failure lowers and how far it lowers them.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/end-to-end/easy/spectra/v2.0.0/`). Each version is self-contained and
frozen once a run references it; design revisions land as new version folders.
`v1.0.0` stays exactly where it is.
