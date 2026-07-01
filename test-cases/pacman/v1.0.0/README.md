# Pac-Man — `v1.0.0` (Fathom)

This is version `v1.0.0` of the **Pac-Man** test case. The implemented game is an
original maze chase titled **Fathom**: a bioluminescent forager grazing plankton
through a pitch-dark trench, where the maze is hidden by fog of war until your
light or a **sonar** pulse reveals it, and three predators each hunt by a
different signal — your **light** (the Lure), your **sound** (the Listener), or
its own **flare** (the Flarefish).

`pacman` is the catalog slug for this lineage of maze-chase cases; `Fathom` is the
original in-game title. The case is inspired by classic maze-chase arcade games
but is not a clone of any of them — the name, look, fog-of-war sensing, sonar, and
predators are original to The Test Cabinet. Notably, it **replaces** the genre's
two most recognizable beats: there are no fixed power pellets and no eating the
hunters (the powerless forager survives by sensing and evasion, not by flipping
the chase), and the visible, personality-driven ghosts become predators you mostly
*cannot* see — felt through the dark by the tells they leak.

## Why this case

Fathom raises the bar above the catalog's easy paddle and grid cases. It still
asks for a real, polished, rendered game with multiple screens and a HUD, but adds
a fog-of-war visibility system (line-of-sight light versus corridor-flooding
sonar), tile-locked maze movement and cornering, three distinct sensory predator
behaviors, and a maze the model must design itself — a genuinely harder
front-end task that should separate stronger builds from weaker ones.

## Contents

| Path                   | Seeded to run? | Purpose                                            |
| ---------------------- | -------------- | -------------------------------------------------- |
| `specs/`               | **Yes**        | The spec handed to the model, by concern.          |
| `assets/`              | **Yes**        | The provided art (sprite sheets); build with these.|
| `prompt.hbs`           | No             | Rendered into the model's prompt; not seeded.      |
| `reference/` (source)  | No             | Canonical visual mockups; rendered to screenshots. |
| reference screenshots  | **Yes**        | Rendered from `reference/`; seeded as targets.     |
| `test-case.toml`       | No             | Manifest: common specs, references, checks, domains, review items. |
| `variants/`            | No             | One TOML file per variant (listed in `variants`).  |
| `README.md`            | No             | This overview.                                     |

The specification is split across `specs/` by concern: `overview.md`,
`playfield.md`, `sensing.md`, `movement.md`, `predators.md`, `flow.md`,
`assets.md` (the provided-art contract), and the mode specs under
`specs/modes/`. The common specs (everything except the variant-only mode
specs) are seeded for every variant; each variant adds at most one extra mode
spec. Each variant is a standalone TOML file under `variants/`, listed in order in
the manifest's `variants` key (the first is the default). The case offers four
variants — `base` (Trench only), `murk`
(adds Murk, where passive light bends around corners like sonar), `reserve` (adds
Reserve, where ink is limited charges refilled by ink-glands), and `beam` (adds
Beam, a second tighter directional sonar pulse).

This version ships a **fixed set of art assets** under `assets/`, seeded into
every run: the player forager (`glimmerfin`), the three predators (`lanternjaw`,
`gloamfin`, `flarefish`), the sonar-pulse and flare-bloom effects, and the trench
tileset (`trench-walls`) — each a sprite-sheet folder of per-frame PNGs, drawn by
The Test Cabinet's own asset-generation cases of the same slugs. The build is
**required to render the game with these assets** (the contract is `specs/assets.md`),
so the art is identical across every run and only the implementation varies. The
model still designs its own conforming maze from the tiles, guided by the palette
and measurements in the specs and by the seeded reference screenshots. Things with
no asset — plankton, the bonus drifter, ink, the forager's glow, and the HUD — are
drawn in code.

The seeded specs and the rendered reference screenshots are copied into a run's
repository. The reference *source* mockups are not seeded, so a model builds the
UI from the specs and the screenshots rather than copying the mockup code.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/pacman/v1.0.0/`). Each version is self-contained and immutable once
a run references it; design revisions land as new version folders.
