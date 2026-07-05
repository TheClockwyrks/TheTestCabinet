# Floe — `v1.0.0`

This is version `v1.0.0` of the **Floe** test case. The implemented game is an
original single-screen arcade crossing game titled **Floe**: a small tundra critter
hops one tile at a time across a frozen strait — over lanes of sliding ice hazards
and across open water on drifting floes — to fill a row of bays on the far shore,
while a polar bear hunts it across the whole strait, held back only by its speed.

`floe` is the catalog slug for this lineage of single-screen crossing cases, and
the
game's in-fiction title. The case is inspired by classic crossing games but is
not a
clone of any of them — the name, look, the arctic strait, the drifting carry-floes,
the goal bays, and above all the **pursuing hunter** are original to The Test
Cabinet. It keeps the genre's defining hook — hop a grid across alternating
bands of
avoid-hazards and ride-platforms to safe slots at the far edge — and layers its
own
signature, a live pursuing predator, on top of it.

## Why this case

Floe raises the bar above the catalog's simplest arcade cases with a harder
shape of
problem: a fixed-step simulation of tile hopping with a **carry/drift** model on
the
floes, a **hunter with real pathfinding** that pursues the critter across the hazard
board and swims after it across the water (and must stay readable while
submerged), a
row of goal bays to fill, a per-crossing timer, an 8-level progression that
speeds up
and adds a second bear, and multiple states and a HUD — a genuinely harder front-end
task than a pure lane-timing game, because the bear turns the crossing into a chase
that punishes every pause.

## Contents

| Path                   | Seeded to run? | Purpose                                            |
| ---------------------- | -------------- | -------------------------------------------------- |
| `specs/`               | **Yes**        | The spec handed to the model, by concern.          |
| `assets/`              | **Yes**        | Provided sprite art: critter, bear, hazards, floe. |
| `prompt.hbs`           | No             | Rendered into the model's prompt; not seeded.      |
| `reference/` (source)  | No             | Canonical visual mockups; rendered to screenshots. |
| reference screenshots  | **Yes**        | Rendered from `reference/`; seeded as targets.     |
| `workspaces/base/`     | **Yes**        | Starter project pinning Playwright (dev dep).      |
| `test-case.toml`       | No             | Manifest: specs, assets, variants, checks, items.  |
| `description.md`       | No             | Site-facing prose.                                 |
| `README.md`            | No             | This overview.                                     |

The specification is split across `specs/` by concern: `overview.md`,
`playfield.md`, `hunter.md` (the signature), `hazards.md`, `water.md`,
`controls.md`, `flow.md`, `assets.md`, the mode spec under `specs/modes/`, and
`proof.md`. This version offers a single `base` variant — the standard **Crossing**
run on the one strait.

The `assets/` sprites are the finished pixel art produced by the companion
asset-generation cases (`floe-bear`, `floe-crosser`, `floe-plow`, `floe-dogsled`,
`floe-car`, `floe-pan`, `floe-raft`) — each folder's frames are the regenerated
output of the matching case's recorded draw operations, so the folder layout and
frame counts under `assets/` match those cases exactly. (The `car/` frame is
currently a placeholder pending the `floe-car` run; swap in its regenerated art
once generated, as with the others.)

Future versions or variants are expected to add rule twists sketched during
design —
a longer endless run, a fog-of-war strait, or a faster hunter — as additional
variants on top of this base.
