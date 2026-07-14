# Holdfast — The tile world: grid, terrain, camera, and resource nodes

This file defines the top-down world the colony lives on: the tile grid, the kinds of
terrain, how the camera views it, and the resource nodes settlers chop and mine. All
positions and sizes are in the logical-pixel coordinate system from `specs/overview.md`
(a fixed `1280 x 720` stage; the colony view is `y` in `[64, 656]`, full width). It is
built on by `specs/settlers.md` (how settlers move across it), `specs/economy.md` (the
things you build onto it), and `specs/combat.md` (where raiders enter and where cover
is).

## The grid

The world is a **top-down grid of square tiles**, seen from directly above. Every
position in the world snaps to this grid; the simulation reasons in tile coordinates
and only renders in pixels.

- A tile is **24 x 24** logical pixels.
- The world is a bounded rectangle of tiles — **60 columns wide** and **44
  rows tall**, **larger than the colony view** so there is a map to explore,
  gather, and defend. Tile `(0, 0)` is
  the top-left of the world.
- The world's outer border is **impassable rock** (below) that seals the play area —
  settlers and raiders cannot leave the map through it. Raiders instead enter from
  designated **edge spawn points** in the walkable border (`specs/combat.md`).

## Terrain kinds

Every tile has a **terrain kind** and may additionally carry a **resource node** or a
**built structure** on top of it. Terrain kinds fall into **walkable ground** and
**blocked** groups.

**Walkable ground** — settlers and raiders can stand on and cross it:

- **Soil** — plain bare ground, the common fill. Walkable; nothing grows on it
  untended.
- **Grass / fertile ground** — richer ground, drawn distinctly (`specs/overview.md`).
  Walkable, and the ground **farm plots** are best placed on (`specs/economy.md`).

**Blocked** — nothing can walk through it:

- **Rock / outcrop** — solid stone. **Impassable** and **not minable** as terrain (it
  is scenery and the map border), so it shapes where the colony can expand and where
  raiders must funnel. (Ore is a *node* on ground, below — not this rock.)

Whether a tile is **walkable** is a property of its terrain plus whatever sits on it:
plain and fertile ground are walkable; rock is not; a resource node or a wall on a
tile blocks it until cleared (`specs/economy.md`, `specs/combat.md`). The owning specs
state each structure's blocking and cover properties.

## Resource nodes

Scattered across the ground are **resource nodes** — the raw materials the colony
gathers. A node sits **on** a walkable ground tile and blocks it until it is worked
away or harvested.

- **Trees** — stands of trees, drawn as a forest node (`specs/overview.md`). A tree is
  **chopped** by a settler (a chop job, `specs/settlers.md`): the settler walks
  adjacent to it and works for a chop time, then the tree is **cleared** (the tile
  becomes plain walkable ground) and yields **wood** to the colony stock
  (`specs/economy.md`). Trees appear in **stands** (clusters), not single scattered
  tiles, so chopping is a deliberate objective.
- **Ore** — veins of mineral in the ground, drawn as an ore node (`specs/overview.md`).
  Ore is **mined** by a settler (a mine job) the same way — work adjacent over a mine
  time — and yields **ore** to the stock, clearing the node. Ore appears in **veins**
  (contiguous runs), so mining is worth routing to. Mining is slower than chopping;
  you tune the exact times (order-of a couple of seconds to chop, several to mine).

Both chopping and mining are **queued jobs**, not instant edits — the player
designates a node and a settler does the work (`specs/settlers.md`,
`specs/controls.md`). While working, the settler plays its **work** animation and
**construction/impact dust** puffs from the node (`specs/assets.md`). A node whose
tile no settler can reach (fully walled off, no adjacent walkable tile) simply waits
in the queue until a path opens.

You may add a small number of further gatherables if your design wants them (for
example loose stone chunks, or wild food a settler can forage) — keep the set small
and state any additions in the `README`.

## The camera

The world is larger than the colony view (`y` in `[64, 656]`), so the colony view is
a **camera** looking down on it:

- The player **pans** the camera across the world (`specs/controls.md`). The camera
  is clamped to the world bounds, so it never scrolls past the sealed edges into
  empty space — at an edge, the world border sits flush against the view edge.
- The camera shows an integer-aligned region of tiles scaled to the colony view; a
  tile is drawn at a consistent on-screen size (a modest zoom is acceptable but not
  required). The two HUD strips are never covered by the world — only the colony
  view region `y` in `[64, 656]` shows tiles.
- On load, the camera is centered on the colony's **starting area** so the player
  sees the settlers and their landing site immediately, before any input.

## What lives on a tile

To summarize the layering the other specs build on: each tile has a **terrain kind**
(walkable ground or blocked rock), may carry **one resource node** (tree or ore) that
blocks it until worked away, and may carry **one built structure** (a wall, door,
floor, bed, stove, farm plot, turret — `specs/economy.md`, `specs/combat.md`). Movement
(`specs/settlers.md`), combat cover (`specs/combat.md`), and the gather-and-build
economy (`specs/economy.md`) all read these properties off the tile.
