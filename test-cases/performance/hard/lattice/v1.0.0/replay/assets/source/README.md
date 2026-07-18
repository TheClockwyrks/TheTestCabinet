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

| Entity | Frames | Canvas | Motion |
| --- | --- | --- | --- |
| `belt` | 8 | 32×32 | scrolling loop, 12 fps |
| `splitter` | 8 | 32×64 | scrolling loop, 12 fps |
| `inserter` | 12 | 64×64 | swing cycle, 12 fps |
| `assembler` | 8 | 96×96 | craft loop, 8 fps |
| `source` | 6 | 32×32 | emit pulse, 8 fps |
| `sink` | 6 | 32×32 | consume pulse, 8 fps |
| `items` | 7 | 16×16 | **not an animation** — one static icon per frame |

## Using them

**Grid and canvas.** The grid cell is 32 px. A belt, source, and sink each fill one
cell. A splitter spans two cells along its cross-flow axis. The assembler covers
3×3 cells. The inserter's canvas is *larger than its cell* — its swing arm reaches
beyond the tile it is anchored to — so it is drawn centred on its anchor cell with
the overhang bleeding into the adjacent cells. The engine resolves which tiles an
entity occupies, so the renderer never derives that geometry itself.

**Facing.** Flat ground entities are drawn in a single canonical orientation — flow
runs **east** — and the renderer rotates them for the other three facings. The
assembler is non-directional and is never rotated. The inserter is directional but
authored to stay rotatable: its base is a centred pivot and its swing happens in the
ground plane, so rotating the east-facing sheet reads correctly for other facings.

**Animation.** Every entity except `items` is a loop played at the rate above.
Playback interpolates between simulation ticks rather than drawing one tick per
frame, so these rates are the sprite's own cycle and are independent of the
simulation's tick rate.

**Item icons.** Frame index is item identity, not a time step, and the seven frames
are the seven items the simulation carries, **in the engine's own order**. Frame
index therefore equals the engine's item index, so the renderer selects an icon
straight from the item index in a belt's canonical state — there is no mapping table
to keep in sync.

| Frame | Icon | Engine item id |
| --- | --- | --- |
| 0 | iron ore | `iron-ore` |
| 1 | iron plate | `iron-plate` |
| 2 | iron gear wheel | `iron-gear` |
| 3 | copper ore | `copper-ore` |
| 4 | copper plate | `copper-plate` |
| 5 | copper cable | `copper-cable` |
| 6 | electronic circuit | `circuit` |

Reordering the `lattice-items` sheet, or adding an icon for something the engine
does not carry, breaks that correspondence.

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
