# Hollowdeep — The tile world: grid, tiles, camera, and digging

This file defines the cross-section world the colony lives in: the tile grid, the
kinds of tile, how the camera views it, and how digging opens space and yields
resources. All positions and sizes are in the logical-pixel coordinate system from
`specs/overview.md` (a fixed `1280 x 720` stage; the colony view is `y` in
`[64, 656]`, full width). It is built on by `specs/gas.md` (the gases that fill open
tiles), `specs/power.md` and `specs/economy.md` (the things you build into tiles),
and `specs/delvers.md` (how delvers move through it).

## The grid

The world is a **cross-section grid of square tiles**, seen from the side. Every
position in the world snaps to this grid; the simulation reasons in tile
coordinates and only renders in pixels.

- A tile is **24 x 24** logical pixels.
- The world is a bounded rectangle of tiles — **64 columns wide** and **44
  rows deep**, **larger than the colony view** so there is a world to explore and
  dig into. Tile `(0, 0)` is the
  top-left of the world.
- The world's outer border — its bottom and side edges, and a cap row or two at the
  very top — is **bedrock** (below) and **cannot be dug**, so the colony is sealed:
  there is no digging out of the world.
- **Gravity points down** (increasing `y`), as in the cross-section: delvers stand
  on floors and fall through open space (`specs/delvers.md`), and CO2 settles
  downward while oxygen rises (`specs/gas.md`).

## Tile kinds

Every tile is exactly one kind. The kinds fall into **solid**, **open**, and
**built** groups.

**Solid (natural) tiles** — dug through to open space:

- **Dirt** — the common fill. Quick to dig; yields a little loose material but no
  ore.
- **Ore** — dirt veined with mineral. Slower to dig; **yields ore** (the raw
  resource refined into build material, `specs/economy.md`). Ore appears in **seams**
  (contiguous runs), not scattered single tiles, so mining is a deliberate objective.
- **Rock** — dense stone. Slowest to dig; yields nothing. It gates where the colony
  can expand.
- **Bedrock** — the world border. **Indestructible**: it cannot be queued for a dig
  and never yields anything. It exists only to seal the world.

**Open tiles** — space delvers can occupy and gas can fill:

- **Open space** — an empty, dug-out (or naturally hollow) tile. It holds gas
  (`specs/gas.md`) and delvers pass through it. Some open space exists at the start
  as the colony's opening cavern; the rest is created by digging.

**Built tiles** — placed by the player and constructed by delvers
(`specs/economy.md`); each is described in the spec that owns it:

- **Wall**, **floor**, **ladder** — structure (`specs/economy.md`,
  `specs/delvers.md`).
- **Wire** — carries power (`specs/power.md`).
- **Machines** and the **fungus farm** — occupy tiles too (`specs/power.md`,
  `specs/economy.md`).

Whether a tile **blocks gas** and whether it is **walkable** is a property of its
kind, used by the gas and delver systems: solid natural tiles and walls block gas
and are not walkable; open space, floors, ladders, and (for gas) most built tiles
are open to gas; floors and ladders are walkable, and a ladder additionally lets a
delver move **vertically** (`specs/delvers.md`). The owning specs state each tile's
properties.

## The camera

The world is larger than the colony view (`y` in `[64, 656]`), so the colony view is
a **camera** onto it:

- The player **pans** the camera across the world (`specs/controls.md`). The camera
  is clamped to the world bounds, so it never scrolls past the sealed edges into
  empty space — at an edge, the world border sits flush against the view edge.
- The camera shows an integer-aligned region of tiles scaled to the colony view; a
  tile is drawn at a consistent on-screen size (a modest zoom is acceptable but not
  required). The two HUD strips are never covered by the world — only the colony
  view region `y` in `[64, 656]` shows tiles.
- On load, the camera is centered on the **starting cavern** so the player sees the
  delvers and their opening space immediately, before any input.

## Digging

Digging is how the colony opens living space and mines ore. It is a **queued job**,
not an instant edit — the player marks what to dig, and a delver does the work
(`specs/delvers.md`).

- **Queue a dig.** The player selects the **dig tool** and marks one or more solid
  (non-bedrock) tiles (`specs/controls.md`); each marked tile shows a clear **dig
  designation** overlay. Bedrock cannot be marked.
- **A delver mines it.** A free delver takes a dig job from the queue, pathfinds to
  a tile **adjacent** to the marked tile (it must be able to stand next to it —
  it cannot mine a tile it cannot reach), and mines for a **dig time** that depends
  on the tile kind: dirt is quickest, ore slower, rock slowest (order-of a second,
  a few seconds, and several seconds respectively; you tune the exact values). The
  delver plays its **dig** animation while mining, and **dig dust** puffs from the
  tile (`specs/assets.md`).
- **The tile opens.** When mining completes, the tile becomes **open space** — now
  part of the gas simulation and walkable-through — and the dig **yields its
  resource**: an **ore** tile drops **ore** (added to the colony's ore stock, or a
  loose item a delver hauls, your choice — state it in the `README`), a **dirt** tile
  drops a small amount of loose material or nothing, and **rock** drops nothing.
- **Digging changes the air.** Opening a tile connects its space to the neighboring
  open tiles, so gas immediately begins to diffuse into it (`specs/gas.md`). Digging
  down into a sealed pocket, or breaking into a new cavity, redistributes the
  colony's air — this coupling is central to the game.
- **Reachability.** A dig job whose tile has no adjacent tile a delver can stand in
  (fully surrounded by solid, with no opened neighbor to work from) simply waits in
  the queue until digging elsewhere exposes a face to work from. Delvers dig
  **inward from open space**, never from inside solid rock.

Cancelling a dig designation (`specs/controls.md`) removes the job. Marked-but-unmined
tiles are just designations; only a completed mine changes the tile.
