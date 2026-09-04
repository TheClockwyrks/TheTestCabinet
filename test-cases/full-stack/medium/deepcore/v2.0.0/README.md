# Deepcore — `v2.0.0`

This is version `v2.0.0` of the **Deepcore** test case. The implemented game is
a subterranean dig-and-build: a prospector stranded on a dead mining world
drills down through banded rock, hauls ore back up against a jetpack-fuel
budget to sell and upgrade, hunts two buried exotic materials with a scanner,
and finally cuts an unstable core sample from the planet's heart and races it to
the surface on a detonation timer, all to fabricate a five-part escape rocket
and launch.

It is a **full-stack** case, which means the model under test does not only
build the game: it **produces the game's own 2D assets during the run**, with
the asset-generation binaries on the `test-cabinet-full-stack-2d` run image's
`PATH`. The headline of that production is the **animated miner**, which must
read distinctly for standing, walking, drilling down, drilling sideways,
thrusting, falling, taking a hit, and running out of fuel.

`deepcore` is the catalog slug for this case, and the mine is the game's own
world. The case belongs to the family of dig-and-sell mining games; the name,
the world, the material ladder and the rocket win condition are original to The
Test Cabinet.

## Why this case

Deepcore is a `medium` full-stack case, and its difficulty is one of interacting
systems. Digging is cheap and climbing is not, so every descent is a round trip
priced in fuel; ore has weight, so a rich haul climbs slower, burns more, and
past a point cannot lift at all; the fuel that buys the next descent is bought
with the ore the last one carried home. Around that sit depth-scaled hazards, a
seven-track upgrade shop, a scanner-driven hunt for two materials that are
guaranteed to exist and hidden, a core sample on a countdown, two death modes,
and a mine taller than the viewport that the camera has to follow. On top of all
of it, every sprite, effect and sound the game plays is authored during the same
run.

## Engines

Deepcore is designed for three engines, and seeds a different project for each.
The camera is what separates them.

| Engine          | What the seeded project supplies                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`          | The toolchain configuration and `index.html`, and nothing else. There is no `src/`. The build writes the frame loop and the delta time it measures, the canvas fit, the keyboard input, the audio, the diagnostics overlay, the scroll transform the mine is drawn through, and the `window.__deepcore` surface, and then the game on top. The surface additionally carries the clock, because nothing outside the build owns it. |
| `simple-2d`     | The [Simple 2D](/engines/simple-2d/) package, vendored at seed time, plus `src/constants.ts` and `src/main.ts`. The build writes `src/game.ts`. The engine owns the loop, the fit, input as named actions, audio as named cues and the overlay; it owns neither rendering nor a camera, so the build draws the mine itself and applies its own scroll transform to the 2D context `render` hands it.                              |
| `structured-2d` | The [Structured 2D](/engines/structured-2d/) package, vendored the same way, plus the same two modules. The build writes its game module: the game definition, its mode, its live state, its actors, and the debug surface its instance's `initialize` returns. This engine owns rendering and a camera, so the scroll down a shaft is `world.camera` following the miner rather than a transform the game applies.               |

The game the three projects describe is the same one, so a score recorded under
one engine is comparable with a score recorded under another.

## The single variant

Deepcore ships one variant, `base` (`variants/base.toml`), and nothing in the
seeded set branches on `variant.slug`. Standard and Hardcore are modes picked
from an in-game menu and change only what death costs; Quick, Standard and
Marathon are a world-size choice on the same menu and scale only how deep the
mine goes. Both are choices the finished game offers its player, not differences
in the game a run is asked to build, so every spec is common and seeded for
every run.

## Contents

| Path                   | Seeded to run? | Purpose                                                                 |
| ---------------------- | -------------- | ----------------------------------------------------------------------- |
| `specs/`               | Yes            | The specification handed to the model, by concern.                      |
| `workspaces/`          | Yes            | The starter TypeScript project, `<engine>/`, seeded at the run root.    |
| `references/`          | No             | The authored, correct build, one directory per engine. Never seeded.    |
| `validation/`          | No             | The validator suites deciding every review point, `<engine>/`.          |
| `prompt.hbs`           | No             | Rendered into the model's prompt; not seeded.                           |
| `test-case.toml`       | No             | Manifest: engines, workspaces, toolchain, specs, domains, review items. |
| `variants/`            | No             | One TOML file per variant (listed in `variants`).                       |
| `description.md`       | No             | The site-facing introduction on the case's detail page.                 |
| `changelog.md`         | No             | This version's entry in the case's changelog.                           |
| `README.md`            | No             | This overview.                                                          |

The specification is split across `specs/` by concern, and every file is seeded
for every run. A file is a Handlebars template only where it branches on the
selected engine; the rest seed verbatim.

| Spec                     | Covers                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `overview.md.hbs`        | What is built, what stays as it is, the code quality, and the commands run over the repository. |
| `world.md.hbs`           | The mine: the grid, the camera over it, the world sizes, the depth bands, the tiles, the camp.  |
| `character.md`           | The miner: its box, its motion, its drilling, its fuel and hull, and its animation states.      |
| `mining.md`              | The ore and gemstones, the cargo bay, the inventory, the exotic materials, and the scanner.     |
| `hazards.md`             | Gas pockets, lava, fall impact, and the unstable Core Sample's timer.                           |
| `upgrades.md`            | The seven upgrade tracks, their tiers, and what each tier costs and gives.                      |
| `rocket.md`              | The five rocket components, what each needs, and the launch that wins.                          |
| `expedition.md`          | The expedition, the Credits economy, the surface loop, saving, and the summary.                 |
| `ui.md`                  | The screens, the menus, the building panels, the status bar, and what is out of scope.          |
| `modes.md`               | Standard and Hardcore, and what a death costs in each.                                          |
| `controls.md.hbs`        | The actions the player drives the miner with and the keys bound to them.                        |
| `items.md`               | The six single-use field supplies, and the Core Sample's jettison.                              |
| `assets.md.hbs`          | The asset-production contract: every asset, which binary makes it, and the bar it is held to.   |
| `instrumentation.md.hbs` | The debug and automation surface, the snapshot shape, and the diagnostics overlay.              |
| `showcase.md.hbs`        | The `showcase/` directory the finished build ships beside its source.                           |

The six templates branch on the engine because the deliverable does. `overview`
and `controls` differ in what the runtime hands the build and what the build
writes; `world` in whether the camera is the engine's or the game's own;
`assets` in who loads a file and who owns the audio cues; `instrumentation` in
how the same operations are reached; and `showcase` in whether motion ships as a
clip or as an engine replay.

## Assets and media

This version declares no seeded assets and no reference mockups, and that is the
point of a full-stack case: the model produces the art, the animation, the
effects and the audio itself, during the run, and builds the game around what it
made. The build that is validated must be self-contained, bundling the committed
produced files and running with the generation binaries absent.

## Validation

This case is validator-rated: every point on the checklist carries a Vitest
suite, and the validators decide the functional rating through each point's
failure cap. A reviewer rates the run's aesthetics and may override a verdict.

`validation/` holds one project per engine, `validation/none/`,
`validation/simple-2d/` and `validation/structured-2d/`, each with a suite per
review point at `<category>/<id>.test.ts`. The `none` suites drive the built
site in Chromium through `window.__deepcore`; the two engine projects run in
process against the vendored engine and reach the surface through
`engine.debug`. The three run the same scenarios and differ only in how they
reach the build.

`validation-baseline/<engine>/<variant>/` holds the media the same suites
captured from that engine's reference build, so a reviewer sees the build's
evidence and the reference's side by side. `tcab capture-baselines` writes that
directory wholesale from the references, so it is regenerated rather than
edited.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/full-stack/medium/deepcore/v2.0.0/`). Each version is
self-contained and immutable once a run references it; design revisions land as
new version folders.
