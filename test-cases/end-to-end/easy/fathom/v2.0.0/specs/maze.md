# Fathom — The maze: geometry, den, and wrap tunnel

This file defines the geometry of the maze and its fixed structures. All positions
and sizes are in the logical-pixel coordinate system and the 32 px tile grid
defined in `specs/overview.md` (36 columns x 18 rows, top-left tile corner at
`(64, 80)`). The things that live in the maze — plankton, the bonus drifters — and
how you perceive it are defined in `specs/gameplay.md`.

## The maze

Each tile is either wall (solid rock the forager and predators cannot enter) or
open (flooded corridor). You design the maze layout; it is not fixed. A conforming
maze satisfies all of the following:

- Corridors are one tile wide. Open tiles form winding one-tile-wide corridors and
  junctions. No open area is wider than one tile: no `2 x 2` or larger block of open
  tiles exists. The den (below) is the only exception.
- Mirror symmetry. The layout is symmetric left-to-right about the vertical
  centerline (between columns 17 and 18).
- Fully connected, with nothing sealed off. The open tiles form one single
  connected region: every open tile is reachable from every other open tile, with no
  sealed-off pockets. The forager's start tile, the den interior (reached through
  its gate), both mouths of the wrap tunnel, and every plankton tile all lie in that
  one region and are mutually reachable. A maze that strands the player, a predator,
  or any plankton is invalid.
- No dead ends; corridors loop. Every open corridor tile connects onward to at
  least two other open tiles (counting the far mouth of the wrap tunnel as one such
  connection), so the forager can always pass through a tile and come back around
  another way, and is never forced into a one-exit pocket it must reverse out of.
  Equivalently, the maze has no dead-end tiles (an open tile with only one open
  orthogonal neighbor). The den chamber is exempt: it is the one open area wider than
  a corridor, entered only through its gate.
- A solid border, except where the wrap tunnel pierces the left and right edges
  (below).
- Corridor tiles cover at least `40%` of the interior (the grid excluding its solid
  border).

The maze must also fall inside both of these hard proportion bounds. Compute each
over the corridor tiles (the open floor tiles the forager can enter, excluding the
den and its gate), where a tile's open neighbors are the orthogonally adjacent
corridor tiles (the far mouth of the wrap tunnel counts as the neighbor across that
edge):

- Openness: the mean number of open neighbors per corridor tile. A single winding
  corridor is `2.0`; junctions push it above `2`; open rooms push it toward `4`. A
  conforming maze keeps openness at `2.8` or below; above `2.8` it is invalid (rooms
  or a grid, not corridors).
- Corridor length ("mazing"): a corridor run is a maximal chain of corridor tiles
  that each have exactly two open neighbors (the straightaways and bends between one
  junction and the next); this metric is the mean run length in tiles. A conforming
  maze keeps mazing at `2.0` or above and at `8.0` or below; below `2.0` it is
  invalid (too grid-like — junctions so dense the forager never commits to a
  corridor) and above `8.0` it is invalid (too sparse — long hallways with few
  choices).

Draw the maze from the provided wall tileset (`assets/trench-walls/`, see
`specs/assets.md`): the corridor floor under every open tile, and the wall autotile
for every wall tile, picking each wall's frame from its wall-neighbors (the N/E/S/W
connection bitmask in `specs/assets.md`) so corridors get rounded rock faces and
walls merge seamlessly. Unrevealed tiles use the fog tile (see `specs/gameplay.md`).

The forager starts each life at a fixed open tile you choose in the lower half of
the maze, on the centerline (so it is symmetric). The predators start in the den.

## The den

A central den holds the predators between releases. It is a small open chamber
around the grid center (around columns 15-20, rows 7-9) enclosed by wall except for
a single gate tile on its top edge (drawn from the den-gate tile, `specs/assets.md`)
through which predators exit and re-enter. The gate is passable only by predators
leaving or returning to the den; the forager cannot enter the den. No plankton sit
inside the den. The den's release schedule and the predators' use of it are defined
in `specs/predators.md`.

## The wrap tunnel

One horizontal wrap tunnel pierces the left and right border at a chosen mid-height
row clear of the den (for example row 12). The corridor at the left edge of that row
and the corridor at the right edge are joined through the wrap: a character (forager
or predator) that exits the left edge there re-enters at the right edge of the same
row, and vice versa, so the two ends are the same corridor. The interior path
between the two edges follows the rest of the maze and need not be a single straight
open row. Movement and speed are continuous through the wrap; nothing stops at the
edge. The wrap is symmetric, so it preserves the left-right mirror.
