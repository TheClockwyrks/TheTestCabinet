# Fathom — `v2.0.0`

This is version `v2.0.0` of the **Fathom** test case. The implemented game is an
original maze chase titled **Fathom**: a bioluminescent forager grazing plankton
through a pitch-dark maze, hidden by fog of war until your
light or a **sonar** pulse reveals it, and three predators each hunt by a
different signal — your **light** (the Lanternjaw), your **sound** (the Gloamfin),
or its own **flare** (the Flarefish).

`fathom` is the catalog slug for this lineage of maze-chase cases, and the game's
in-fiction title. The case is inspired by classic maze-chase arcade games
but is not a clone of any of them — the name, look, fog-of-war sensing, sonar, and
predators are original to The Test Cabinet. Notably, it **replaces** the genre's
two most recognizable beats: there are no fixed power pellets and no eating the
hunters (the powerless forager survives by sensing and evasion, not by flipping
the chase), and the visible, personality-driven ghosts become predators you mostly
*cannot* see — felt through the dark by the tells they leak.

## Why this case

Fathom raises the bar above the catalog's easy paddle and grid cases. It still
asks for a real, polished, rendered game with multiple screens and a HUD, but adds
a signature sensing system — in two variants, a remembered (StarCraft-style) fog of
war read by line-of-sight light and corridor-flooding sonar, or that same fog seen
only through a fed, growing vision circle — tile-locked maze movement and cornering,
three distinct
sensory predator behaviors, and a maze the model must design itself — a genuinely
harder front-end task that should separate stronger builds from weaker ones.

## Contents

| Path                  | Seeded to run? | Purpose                                                            |
| --------------------- | -------------- | ------------------------------------------------------------------ |
| `specs/`              | **Yes**        | The spec handed to the model, by concern.                          |
| `assets/`             | **Yes**        | The provided art (sprite sheets); build with these.                |
| `prompt.hbs`          | No             | Rendered into the model's prompt; not seeded.                      |
| `reference/` (source) | No             | Canonical visual mockups; rendered to screenshots.                 |
| reference screenshots | **Yes**        | Rendered from `reference/`; seeded as illustrative examples.       |
| `test-case.toml`      | No             | Manifest: common specs, references, checks, domain, review items.  |
| `variants/`           | No             | One TOML file per variant (listed in `variants`).                  |
| `README.md`           | No             | This overview.                                                     |

The specification is split across `specs/` by concern: `overview.md`, `maze.md`
(the map geometry, den, and wrap tunnel), `gameplay.md` (plankton, the bonus
drifters, ink, and the signature sensing model), `movement.md`, `predators.md` plus
one file per kind under `predators/`, `progression.md`, `ui.md` (menus, game states,
and HUD), `assets.md` (the provided-art contract), and `instrumentation.md` (the
`window.__fathom` debug API). Every spec is **common** — seeded for every variant.
The **sensing** system is the axis the variants differ on; rather than a separate
per-variant file it is folded into `gameplay.md`, which is a Handlebars template
rendered with the selected variant (as are `ui.md` and `instrumentation.md`), so a
variant seeds no sensing file of its own and the model always sees exactly one
coherent specification. Each variant is a standalone TOML file under `variants/`,
listed in order in the manifest's `variants` key (the first is the default). The
case offers two variants:

- **`base` (Standard)** — a StarCraft-style remembered fog of war, line-of-sight
  passive light, and a corridor-flooding sonar pulse.
- **`kindle` (Kindle)** — the same fog of war as base, plus an outer **vision
  circle** you carry (an actual circle that grows as you eat) beyond which the
  explored map is pitch black. It reveals nothing — it only limits what of the
  already-revealed maze is shown, so you see only the windowed part of your
  explored map.

This version ships a **fixed set of art assets** under `assets/`, seeded into
every run: the player forager (`glimmerfin`), the three predators (`lanternjaw`,
`gloamfin`, `flarefish`), the flare-bloom effect, and the maze wall tileset
(`trench-walls`) — each a sprite-sheet folder of per-frame PNGs, drawn by
The Test Cabinet's own asset-generation cases of the same slugs. The build is
**required to render the game with these assets** (the contract is `specs/assets.md`),
so the art is identical across every run and only the implementation varies. The
model still designs its own conforming maze from the tiles, guided by the palette
and measurements in the specs. Things with
no asset — plankton, the bonus drifter, ink, the forager's glow, and the HUD — are
drawn in code.

The seeded specs and the rendered reference screenshots are copied into a run's
repository. The reference *source* mockups are not seeded, and the seeded screenshots are
illustrative examples only — the model builds every screen from the specs, which
are complete on their own, rather than from the screenshots.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/fathom/v2.0.0/`). Each version is self-contained and immutable once
a run references it; design revisions land as new version folders.
