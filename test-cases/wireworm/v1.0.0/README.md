# Wireworm — `v1.0.0`

This is version `v1.0.0` of the **Wireworm** test case. The implemented game
is an
original fixed-shooter arcade game titled **Wireworm**: a segmented data-worm winds
down a circuit board through a field of capacitor nodes, and you cut it apart
from a
band at the bottom — where every node the worm bumps gains charge, and
shooting a
critical node detonates a chain-arc through the charged cluster, so holding the
board is about pacing charge as much as aiming.

`wireworm` is the catalog slug for this lineage of "field of obstacles"
fixed-shooter cases, and the game's in-fiction title. The case is inspired by
classic fixed-shooter arcade games but is not a clone of any of them — the name,
look, the charged-node field and chain-arc discharge, the critical-node worm dive,
the field that grows as you shoot, and the three foes are original to The Test
Cabinet. It keeps the genre's defining hooks — a segmented enemy winding down a
field of destructible terrain, split into two when shot mid-body, and a shooter
confined to a shallow band — and layers its own signature, the charged field, on
top of them.

## Why this case

Wireworm raises the bar above the catalog's simplest arcade cases with a harder
shape of problem: a fixed-step simulation of a segmented worm that winds a tile
field and splits into independent worms when shot, a charged-terrain model
with a
**chain-reaction discharge** that clears clusters and culls the worm, a field that
**persists and thickens** across a level run (so difficulty compounds from the
player's own fire), three distinct foes that each manipulate the field, a
band-bound cursor, a 12-level progression with a win and a loss, and multiple
states and a HUD — a genuinely harder front-end task that should separate stronger
builds from weaker ones.

## Contents

| Path                   | Seeded to run? | Purpose                                            |
| ---------------------- | -------------- | -------------------------------------------------- |
| `specs/`               | **Yes**        | The spec handed to the model, by concern.          |
| `assets/`              | **Yes**        | Provided sprite art: nodes, worm, cursor, foes.    |
| `prompt.hbs`           | No             | Rendered into the model's prompt; not seeded.      |
| `reference/` (source)  | No             | Canonical visual mockups; rendered to screenshots. |
| reference screenshots  | **Yes**        | Rendered from `reference/`; seeded as targets.     |
| `workspaces/base/`     | **Yes**        | Starter project pinning Playwright (dev dep).      |
| `test-case.toml`       | No             | Manifest: specs, assets, variants, checks, items.  |
| `description.md`       | No             | Site-facing prose.                                 |
| `README.md`            | No             | This overview.                                     |

The specification is split across `specs/` by concern: `overview.md`,
`playfield.md`, `charge.md` (the signature), `worm.md`, `foes.md`, `controls.md`,
`flow.md`, `assets.md`, `standard.md` (the playable mode), and `proof.md`. This
version offers a single `base` variant — the standard **Descent** run down the one
board.

The `assets/` sprites are the finished pixel art produced by the companion
asset-generation cases (`wireworm-node`, `wireworm-worm`, `wireworm-cursor`,
`wireworm-glitch`, `wireworm-dropper`, `wireworm-corruptor`) — each folder's frames
are the regenerated output of the matching case's recorded draw operations, so the
folder layout and frame counts under `assets/` match those cases exactly.

Future versions or variants are expected to add rule twists sketched during design
— a longer endless run, a denser starting field, or a faster worm — as additional
variants on top of this base.
