# Coil — Board, cells, walls, and pellets

This file defines the geometry of the board and the objects on it. All positions
and sizes are in the logical-pixel coordinate system defined in
`specs/overview.md` (a fixed 1280 x 720 stage, origin top-left), and the grid
indexing defined here.

## The grid

The board is a rectangular grid of square cells. The grid includes its wall
border:

- The full grid is 30 columns x 18 rows.
- Each cell is 32 x 32 logical pixels.
- The grid's top-left corner sits at logical pixel `(160, 120)`, so the full
  board spans `x` in `[160, 1120]` and `y` in `[120, 696]` (960 x 576).
- The band above the board, `y` in `[0, 120)`, is reserved for the HUD (see
  `specs/ui.md`).

Cells are indexed `(col, row)` with `col` in `[0, 29]` and `row` in `[0, 17]`,
counting from the top-left. The logical-pixel top-left of cell `(col, row)` is:

```text
x = 160 + col * 32
y = 120 + row * 32
```

The simulation operates entirely in these integer cell coordinates. Rendering
maps each occupied cell to its logical-pixel square and then to the screen.

## Cell types

Every cell is exactly one of:

- Wall — a perimeter cell. Walls are impassable and fatal on contact.
- Empty — an unoccupied interior cell the snake may move through.
- Snake — a cell occupied by a segment of the snake (head or body).
- Pellet — the cell holding the current pellet.

## Walls

The wall border is one cell thick on all four sides:

- The top row (`row = 0`) and bottom row (`row = 17`).
- The left column (`col = 0`) and right column (`col = 29`).

This leaves an interior playable area of 28 x 16 cells: `col` in `[1, 28]` and
`row` in `[1, 16]`. Walls are drawn in the wall-border color, are always visible,
and never change during a round. The snake dies the moment its head enters any
wall cell (see Collision in `specs/movement.md`).

## The snake

- The snake is a contiguous, non-branching chain of cells. The first cell is the
  head; the rest are body segments in order to the tail.
- At the start of a round the snake has a length of 3 cells and is placed
  horizontally near the center of the board, facing right (`+col`):
  - head at `(15, 8)`,
  - body at `(14, 8)`,
  - tail at `(13, 8)`.
- The snake never occupies a position between cells; it is always grid-aligned.
  How it advances, grows, and collides is defined in `specs/movement.md`.

## Pellets

- Exactly one pellet exists on the board at any time during play.
- A pellet occupies a single interior cell and is drawn the same size as one
  snake segment, in the pellet color with a soft glow.
- When the snake's head enters the pellet's cell, the pellet is eaten: the snake
  grows (see `specs/movement.md`) and a new pellet spawns immediately.

### Placement

A pellet spawns at a uniformly random cell chosen from the set of valid cells. A
valid cell is an interior cell (`col` in `[1, 28]`, `row` in `[1, 16]`) that is
not currently occupied by any snake segment or by the current pellet. A pellet
never spawns on a wall or on the snake. The placement selects a uniformly random
valid cell without noticeable delay even when very few valid cells remain, for
example when the snake has grown to fill most of the board.

The first pellet of a round spawns at a valid cell after the snake has been placed
at its starting position, so it never overlaps the initial body.

If the snake grows until no valid cell remains for a new pellet, the round ends on
the board-cleared win condition (see Game states in `specs/ui.md`): the
round ends cleanly, and the game does not crash or attempt an impossible
placement.
