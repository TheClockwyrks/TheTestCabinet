# Coil — `v1.0.0`

This is version `v1.0.0` of the **Coil** test case, a **full-stack** case. The
implemented game is an original grid-and-growth game titled **Coil**: classic
grid-locked snake mechanics plus a **combo** multiplier (pellets eaten in quick
succession score more), played in **Maze** mode — the always-present Classic
board plus fixed fatal interior obstacles to navigate around. On top of building
the game, the model must **produce** the snake's own sprite set (an animated
biting head plus body and corner sprites for its turns) and the game's sound and
music with the asset-generation tools on the run image's `PATH`.

`coil` is the catalog slug for this lineage of grid-and-growth cases, and the
game's in-fiction title. The case is inspired by classic snake games but is
not a clone of any of them — the name, look, and combo mechanic are original to
The Test Cabinet.

## Why Snake

Snake's rules are among the simplest in the catalog, but this version pairs that
tidy simulation with a small art-and-audio pass, so it exercises both sides of a
build at once. The game still asks for a real, polished, rendered game: a correct
fixed-timestep loop, grid-locked movement and turning, the subtle self-collision
and food-placement rules that are easy to get *almost* right, a decaying combo,
persistent high scores, and multiple screens. On top of that, as a full-stack
case it asks the model to produce the snake's sprite set — including a head that
animates a bite when it eats and corner sprites that render clean turns — and the
game's sound and music, then wire the produced files into the build. A correct
game with a code-drawn snake, or nice sprites bolted to a game that mishandles
turning, each falls short; the case rewards getting the code *and* the craft
right, without the scale of the harder cases.

## Contents

| Path                  | Seeded to run? | Purpose                                                            |
| --------------------- | -------------- | ------------------------------------------------------------------ |
| `specs/`              | **Yes**        | The spec handed to the model, by concern.                          |
| `prompt.hbs`          | No             | Rendered into the model's prompt; not seeded.                      |
| `reference/` (source) | No             | Canonical visual mockups; rendered to screenshots.                 |
| reference screenshots | **Yes**        | Rendered from `reference/`; seeded as targets.                     |
| `test-case.toml`      | No             | Manifest: common specs, references, checks, domains, review items. |
| `variants/`           | No             | One TOML file per variant (listed in `variants`).                  |
| `README.md`           | No             | This overview.                                                     |

The specification is split across `specs/` by concern: `overview.md`,
`playfield.md`, `mechanics.md`, `flow.md`, `assets.md` (the production contract
for the assets the model must make), and the mode specs under `specs/modes/`.
The common specs (overview, playfield, mechanics, flow, assets, and
`modes/standard.md`) are seeded for every variant; each variant adds at most one
extra mode spec. Each variant is a standalone TOML file under `variants/`, listed
in the manifest's `variants` key. This version offers a single variant, `maze`,
which adds the Maze mode and declares its own scoring domain, rated independently
of the common gameplay and presentation domains.

This version ships **no pre-made assets**: as a full-stack case, the run image
puts the 2D asset-generation binaries on the model's `PATH`, and the model
produces the snake's sprite set and the game's sound and music with them during
the run, then bundles the committed files into the build (`specs/assets.md`).
The board, walls, obstacles, pellet, and HUD stay drawn in code.

The seeded specs and the rendered reference screenshots are copied into a run's
repository (plus assets, when a case has them). The reference *source* mockups
are not seeded, so a model builds the UI from the specs and the screenshots
rather than copying the mockup code.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/coil/v1.0.0/`). Each version is self-contained and immutable once
a run references it; design revisions land as new version folders.
