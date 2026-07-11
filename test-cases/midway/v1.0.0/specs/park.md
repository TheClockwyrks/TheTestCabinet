# Midway — The park grid: ground, paths, placement, and the camera

This file defines the plot the park is built on: the tile grid, the ground and
scenery, the paths guests walk, how rides and stalls are placed on it, and how the
camera views it. All positions and sizes are in the logical-pixel coordinate system
from `specs/overview.md` (a fixed `1280 x 720` stage; the park view is `y` in
`[64, 656]`, full width). It is built on by `specs/guests.md` (who walk the paths),
`specs/rides.md` and `specs/staff.md` (the things placed on it), and
`specs/economy.md` (what placing them costs).

## The grid

The park is a **top-down grid of square tiles**, seen from directly above. Every
position in the park snaps to this grid; the simulation reasons in tile coordinates
and only renders in pixels.

- A tile is **24 x 24** logical pixels.
- The plot is a bounded rectangle of tiles — **64 columns wide** and **44
  rows deep**, **larger than the park
  view** so there is room to grow and a park to pan across. Tile `(0, 0)` is the
  top-left of the plot.
- The plot's outer edge is a **fence** (a border the player cannot build on or
  remove) with a single fixed **entrance gate** in it, where guests enter and leave
  (`specs/guests.md`). The fence seals the park: there is no walking off the plot
  except back out through the gate.

## Tile kinds

Every tile is exactly one kind. The kinds fall into **ground**, **path**, and
**built** groups.

**Ground tiles** — the raw plot before you shape it:

- **Grass** — open, buildable ground. Rides, stalls, scenery, and paths are all
  placed onto grass. It is not walkable by guests (guests keep to paths, below).
- **Water** — a pond or stream: decorative ground that **cannot** be built or pathed
  on, so it constrains layout. Some may exist at the start, and you may let the
  player place a little as scenery (your choice; state it in the `README`).
- **Fence / gate** — the sealed border and its single entrance gate, above.

**Path tiles** — the walkable network:

- **Path** — a paved walkway the player lays onto grass. Guests (and staff) walk
  **only** on path tiles and the queue tiles of the things attached to them; a ride
  or stall is reachable only if its entrance touches a path connected back to the
  gate. Path tiles connect edge-to-edge (4-connectivity) into one walkable graph.

**Built tiles** — placed by the player (`specs/controls.md`) and paid for
(`specs/economy.md`); each is described in the spec that owns it:

- **Rides** and **stalls** — multi-tile attractions and shops (`specs/rides.md`).
- **Scenery** — trees, flowerbeds, benches, lamps, fountains, and the like (below).

## Paths

Paths are the skeleton of the park: nothing works until it is connected to the gate
by path.

- **Laying path.** With the **path tool** (`specs/controls.md`) the player paints
  path onto grass tiles, clicking a tile or **dragging** to lay a run or block of
  path at once. Each path tile costs material/money (`specs/economy.md`). Path
  cannot be laid on water, on the fence, or on a tile already occupied by a ride,
  stall, or scenery.
- **Connectivity.** Guests and staff walk the path graph and nothing else. A ride or
  stall whose entrance is not reachable from the gate by a continuous path gets **no
  guests**, however good it is — connecting things to the network is core play. The
  build should make an unconnected attraction's problem legible (for example a "no
  path" flag on it).
- **Removing path.** The **demolish tool** (`specs/controls.md`) clears a path tile
  back to grass; guests standing on a removed tile reroute (or are nudged to the
  nearest path). Removing the only path to an attraction strands it.

## Placing rides, stalls, and scenery

Rides, stalls, and scenery are **placed** by the player and take effect immediately
(a placement is an instant purchase — you pay and it appears, no build queue),
subject to legal placement:

- **Footprint.** Each ride or stall occupies a rectangular **footprint** of tiles
  (a carousel a few tiles square, a coaster a longer run, a stall one or two tiles;
  you choose the exact sizes). The footprint must sit entirely on buildable grass,
  within the fence, not overlapping another built thing or water.
- **Entrance on a path.** Every ride and stall has an **entrance / queue tile** that
  must be **adjacent to a path** (`specs/rides.md`), or it cannot take guests.
  Placement that would leave an attraction with no path-adjacent entrance is legal
  to build but flagged as unreachable until a path reaches it.
- **Cost and refusal.** Placement costs money from the budget (`specs/economy.md`);
  if the park cannot afford it, or the placement is illegal (off-grass, overlapping,
  no room), it is **refused clearly** — a red ghost, a rejected click — not silently
  dropped.
- **Scenery and appeal.** Scenery tiles (trees, flowerbeds, benches, lamps,
  fountains) are cheap decorations placed on grass. Scenery raises the **appeal** of
  nearby path tiles, and guests walking appealing, decorated stretches gain a little
  happiness (`specs/guests.md`); a bare park of gray paths is dreary and drags mood.
  Benches additionally give tired guests somewhere to **rest** (`specs/guests.md`).
  Keep the appeal model simple but real: decorating visibly lifts the crowd's mood.

## The camera

The plot is larger than the park view (`y` in `[64, 656]`), so the park view is a
**camera** onto it:

- The player **pans** the camera across the park (`specs/controls.md`). The camera
  is clamped to the plot bounds, so it never scrolls past the fence into empty space
  — at an edge, the fence sits flush against the view edge.
- The camera shows an integer-aligned region of tiles scaled to the park view; a
  tile is drawn at a consistent on-screen size (a modest zoom is acceptable but not
  required). The two HUD strips are never covered by the park — only the park view
  region `y` in `[64, 656]` shows tiles.
- On load, the camera is centered on the **entrance gate and its plaza** so the
  player sees where guests arrive and can start laying path immediately, before any
  input.
