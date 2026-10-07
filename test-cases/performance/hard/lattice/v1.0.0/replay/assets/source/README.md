# Lattice renderer sprites — source frames

The sprite set the [browser
playback](../../../../../../../apps/docs/src/content/docs/testing/performance/lattice/architecture.md)
renderer composites onto the grid the canonical state describes. The renderer holds
no art of its own; these are its only pixels.

As with [Foray's sprites](../../../../../../adversarial/hard/foray/v1.0.0/replay/assets/source/),
the art is itself produced by The Test Cabinet: each entity's sheet is the output of
its own `lattice-*` [asset-generation](../../../../../../asset-generation/) case,
drawn one operation at a time against that case's brief. These are the
**regenerated** frames — the images rebuilt from each run's recorded action log,
which is the authoritative output — not the run's own previews.

## What exists

Frames are named `<entity>_<index>.png`, flat, mirroring Foray's `source/`
convention. Each entity is seeded at its case's declared canvas.

| Entity          | Frames | Canvas | Motion                                                                                                              |
| --------------- | ------ | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `belt`          | 48     | 32×32  | three tiers of a straight loop (8) then a curve loop (8); tread scrolls at 12 / 16 / 20 fps                         |
| `splitter`      | 8      | 32×64  | scrolling loop, 12 fps                                                                                              |
| `lane-splitter` | 8      | 32×64  | scrolling loop with two outward-riding spreader heads, 12 fps (engine-simulated; no scored scenario places one yet) |
| `inserter`      | 36     | 64×64  | three tiers of a 12-frame swing cycle, 12 / 16 / 20 fps                                                             |
| `assembler`     | 24     | 96×96  | three tiers of an 8-frame craft loop, 8 / 11 / 13 fps                                                               |
| `source`        | 6      | 32×32  | emit pulse, 8 fps                                                                                                   |
| `sink`          | 6      | 32×32  | consume pulse, 8 fps                                                                                                |
| `furnace`       | 12     | 64×64  | two states — an `off` idle (0–3, 6 fps) then a `smelting` burn loop (4–11, 12 fps)                                  |
| `items`         | 17     | 32×32  | **not an animation** — one static icon per frame                                                                    |

The belt, inserter, and assembler are drawn across **three upgrade tiers**, laid end
to end in the frame order below. `sheet.json` records each tier's frame indices and
its own playback rate, and the renderer picks the tier from a belt's scenario `tier`
(`slow`/`fast`/`express` → tier 1/2/3). The inserter and assembler have no engine
tier yet, so the renderer draws tier 1 and the higher tiers wait for it.

| Entity      | Tier 1                   | Tier 2                      | Tier 3                      |
| ----------- | ------------------------ | --------------------------- | --------------------------- |
| `belt`      | 0–7 straight, 8–15 curve | 16–23 straight, 24–31 curve | 32–39 straight, 40–47 curve |
| `inserter`  | 0–11                     | 12–23                       | 24–35                       |
| `assembler` | 0–7                      | 8–15                        | 16–23                       |

## Using them

**Grid and canvas.** The grid cell is 32 px. A belt, source, and sink each fill one
cell. A splitter — and the `lane-splitter`, which shares its two-cell footprint —
spans two cells along its cross-flow axis. The furnace covers 2×2
cells; the assembler covers 3×3 cells. The inserter's canvas is _larger than its
cell_ — its swing arm reaches
beyond the tile it is anchored to — so it is drawn centred on its anchor cell with
the overhang bleeding into the adjacent cells. The engine resolves which tiles an
entity occupies, so the renderer never derives that geometry itself.

**Facing.** Flat ground entities are drawn in a single canonical orientation — flow
runs **east** — and the renderer rotates them for the other three facings. The
assembler and the furnace are non-directional and are never rotated. The inserter is
directional but authored to stay rotatable: its base is a centred pivot and its swing
happens in the
ground plane, so rotating the east-facing sheet reads correctly for other facings.

**Animation.** Every entity except `items` is a loop played at the rate above.
Playback interpolates between simulation ticks rather than drawing one tick per
frame, so these rates are the sprite's own cycle and are independent of the
simulation's tick rate. The `furnace` is the one entity with **two** loops
rather than one: `sheet.json` records an `off` and a `smelting` state, and the
renderer plays the state the furnace is in. Like the machine item icons it is
**provisional** — the engine places no furnace yet, so nothing resolves it
until the engine gains the entity.

The `lane-splitter` is now simulated by `lattice-core` — it takes a single input and
unzips its two lanes onto the two outputs' outer lanes — so the renderer resolves its
row whenever a scenario places one (e.g. in the designer app). No **scored** scenario
places one yet, so it stays unused in the three reference factories until one does;
its art is a scrolling belt loop with two spreader heads that ride outward.

**Item icons.** Frame index is item identity, not a time step. Frames 0–6 are the
seven items the simulation carries today, **in the engine's own order**, so the
frame index equals the engine's item index and the renderer selects an icon straight
from a belt's canonical state — no mapping table to keep in sync.

Frames 7–15 are the craftable **machines** (belt / assembler / inserter, each in
three tiers). They are seeded with **provisional** engine item ids: the engine's
recipe phase must append these nine to `lattice_core::prototypes::ITEMS` in this
exact order, because the item index is the canonical-bytes contract. Until then the
engine emits none of them, and the renderer only ever looks up an id the engine
actually carries, so these icons sit unused (never drawn as the wrong item).

Frame 16 is **coal**, an eighth base material appended **after** the machines. It is
likewise **provisional** — the engine's item table stops at index 15 today, so it
never emits index 16 and this icon stays unused — and it is placed last, not among
the other materials, precisely so every earlier index (the checksum contract) is
unchanged when coal is eventually added to `ITEMS`.

| Frame | Icon                    | Engine item id                           |
| ----- | ----------------------- | ---------------------------------------- |
| 0     | iron ore                | `iron-ore`                               |
| 1     | iron plate              | `iron-plate`                             |
| 2     | iron gear wheel         | `iron-gear`                              |
| 3     | copper ore              | `copper-ore`                             |
| 4     | copper plate            | `copper-plate`                           |
| 5     | copper cable            | `copper-cable`                           |
| 6     | electronic circuit      | `circuit`                                |
| 7     | transport belt (tier 1) | `transport-belt` _(provisional)_         |
| 8     | transport belt (tier 2) | `fast-transport-belt` _(provisional)_    |
| 9     | transport belt (tier 3) | `express-transport-belt` _(provisional)_ |
| 10    | assembler (tier 1)      | `assembler` _(provisional)_              |
| 11    | assembler (tier 2)      | `fast-assembler` _(provisional)_         |
| 12    | assembler (tier 3)      | `express-assembler` _(provisional)_      |
| 13    | inserter (tier 1)       | `inserter` _(provisional)_               |
| 14    | inserter (tier 2)       | `fast-inserter` _(provisional)_          |
| 15    | inserter (tier 3)       | `express-inserter` _(provisional)_       |
| 16    | coal                    | `coal` _(provisional)_                   |

Reordering the `lattice-items` sheet, or changing which engine item id a frame maps
to, breaks that correspondence.

## Refreshing a sprite

Re-run the entity's `lattice-*` case and pull that run's regenerated frames into
this directory as `<entity>_<index>.png`:

```
GET {artifacts}/runs/{runId}/asset/regenerated-{index}.png
```

Frame count and canvas come from the case's `test-case.toml`, so a case that
changes its sheet length or canvas changes what belongs here. Re-seed after revising
a case's brief — a sprite drawn against an older brief renders the older design, and
the renderer has no way to detect that.
