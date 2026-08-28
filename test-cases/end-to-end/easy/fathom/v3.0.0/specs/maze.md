# Fathom — The maze, the den, and the wrap tunnel

This file defines the maze: what a tile is, the rules every laid-out maze
satisfies, the central den, and the horizontal wrap tunnel. Positions and sizes
are in the logical units and on the tile grid `specs/overview.md` fixes,
`GRID_COLS` (`36`) columns by `GRID_ROWS` (`18`) rows of `TILE` (`32`) units
each, with column `0`'s left edge at `64` and row `0`'s top edge at `80`.

What lives in the maze is in `specs/gameplay.md`, how the forager travels through
it in `specs/movement.md`, and what the predators do once they are out of the den
in `specs/predators.md`.

The layout is yours to design. There is no fixed maze, and every maze the game
lays out satisfies every rule in this file.

## Tiles

Each tile is one of four kinds, reported in the layout `specs/state.md` defines
under the characters below.

| Character | The tile is | Entered by |
| --- | --- | --- |
| `#` | Rock, solid trench wall. | Nothing. |
| `.` | Corridor, flooded open water. | The forager and the predators. |
| `d` | Den interior. | The predators. |
| `g` | The den gate. | The predators. |

Two tiles are neighbors when they are orthogonally adjacent. The wrap tunnel adds
one further pair, the two mouths of its pierced row. A corridor neighbor of a
tile is a neighbor of it that is a corridor tile.

## A conforming maze

- Corridor width. No four corridor tiles form a `2 x 2` block anywhere on the
  grid, so corridors run one tile wide throughout, winding between junctions. The
  den chamber is the one open area wider than a corridor, and it is made of
  den-interior tiles.
- Mirror symmetry. Column `c` and column `GRID_COLS - 1 - c` carry the same kind
  of tile in every row: rock mirrors rock, and a tile that is not rock mirrors a
  tile that is not rock. The axis of that mirror runs between columns `17` and
  `18`. A pair is exempt when either of its two tiles is den interior or the den
  gate.
- A solid border. Row `0`, row `17`, column `0` and column `35` are rock, apart
  from the two wrap-tunnel mouths.
- No dead ends. Every corridor tile has at least two corridor neighbors, so the
  forager passes through a tile and comes back around another way.
- One connected region. Every corridor tile is reachable from every other
  corridor tile, moving only between corridor neighbors. The forager's start
  tile, both mouths of the wrap tunnel, and every tile that holds a plankton lie
  in that one region.
- A reachable den. Following neighbors that are corridor, den-interior or
  den-gate tiles, the forager's start tile is reachable from every den-interior
  tile, so a predator that leaves the den can reach the forager.

## Proportions

Three measures fix how the maze reads. Each is computed over the corridor tiles
alone, with the den interior and the den gate excluded from both the tiles
measured and the neighbors counted. Both bounds of each are inclusive.

| Measure | Lower bound | Upper bound |
| --- | --- | --- |
| Openness | `MAZE_OPENNESS_MIN` (`2.0`) | `MAZE_OPENNESS_MAX` (`2.8`) |
| Corridor run | `MAZE_MAZING_MIN` (`2.0`) | `MAZE_MAZING_MAX` (`8.0`) |
| Density | `MAZE_DENSITY_MIN` (`0.40`) | `MAZE_DENSITY_MAX` (`1.0`) |

Openness is the mean number of corridor neighbors per corridor tile: the total
corridor-neighbor count over every corridor tile, divided by the number of
corridor tiles.

A corridor run is a maximal group of corridor tiles that each have exactly two
corridor neighbors and that are connected to one another as neighbors: the
straightaways and bends between one junction and the next. Its length is the
number of tiles in it, and the corridor-run measure is the mean length over every
run in the maze.

Density is the number of corridor tiles divided by the number of cells inside the
border, `(GRID_COLS - 2) * (GRID_ROWS - 2)`, which is `544`.

## The forager's start tile

One corridor tile in the lower half of the grid, rows `9` through `16`, chosen by
you and fixed for as long as that maze stands. The forager begins the maze on
that tile and returns to it at the start of each life. The predators begin in the
den.

## The den

A single open chamber near the grid center holds the predators between releases.

- The chamber is made of den-interior tiles and covers around columns `15`
  through `20` and rows `7` through `9`.
- It has exactly one gate tile, on its top edge.
- It is enclosed. No den-interior tile has a corridor neighbor, so the gate is
  the chamber's only opening onto the corridors.
- The gate is the predators' door, crossed leaving the den and crossed again
  returning to it. The forager stands on neither the gate nor a den-interior tile
  at any point.

`specs/predators.md` fixes the schedule the den releases on and what a predator
does once it is out.

## The wrap tunnel

One horizontal wrap tunnel joins the left and right borders.

- Exactly one row is pierced: its column `0` tile and its column `35` tile are
  both corridor. Every other row carries rock in both border columns.
- The pierced row carries no den-interior tile and no den gate.
- The two mouths, `(0, row)` and `(35, row)`, are neighbors of each other. A
  character travelling left off the left mouth arrives on the right mouth, and
  one travelling right off the right mouth arrives on the left mouth, on the same
  row.
- The crossing is one ordinary step. Travelling from one mouth's center to the
  other's covers `TILE` (`32`) units, the same ground as any step between
  neighbors, at the speed the character was already making. Nothing stops at the
  border.
- Position is carried across rather than snapped. A crossing step advances a
  character by the same distance as any other step of that move, leaving it as
  far past the far border as it had gone past the near one, and a character's
  center stays inside the maze region, `x` within `[64, 1216]`.

The corridor route between the two mouths through the interior of the maze is
yours to lay out. Both the forager and the predators use the tunnel, under the
movement rules their own files give.

## Drawing the maze

Draw the maze from the provided maze tileset (`assets/trench-walls/`, see
`specs/assets.md`): the corridor floor under every corridor tile, the wall
autotile frame for every rock tile, chosen from that tile's rock neighbors by the
connection bitmask `specs/assets.md` defines, and the den-gate tile on the gate,
so corridors get rounded rock faces and neighboring rock merges seamlessly. A
tile the fog has not revealed is drawn as unrevealed fog, as `specs/sensing.md`
defines.

## Posed layouts

The debugging surface's `setMaze` replaces the layout with a fixture written in
these same four characters. A posed fixture is exempt from every rule in this
file, as `specs/instrumentation.md` states. The rules above govern the mazes the
game lays out for itself.
