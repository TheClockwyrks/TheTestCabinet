# Coil — The board

This file fixes the board's geometry, the kinds of cell on it, the chain the
snake starts as, and where a pellet may spawn. Positions are in the logical units
of `specs/overview.md`. Every figure below carries the name this specification
gives it.

## The cell grid

The board is a rectangular grid of square cells, and the grid includes the wall
border around it.

| Figure | Name | Value |
| --- | --- | --- |
| Columns | `GRID_COLS` | `30` |
| Rows | `GRID_ROWS` | `18` |
| Cell side | `CELL` | `32` |
| Board origin, x | `BOARD_X` | `160` |
| Board origin, y | `BOARD_Y` | `120` |

The board therefore spans `x` in `[160, 1120]` and `y` in `[120, 696]`, which is
`960 x 576`. The band above it, `y` in `[0, BOARD_Y)`, is the HUD band that
`specs/ui.md` lays out.

Cells are indexed `(col, row)` from the top-left, with `col` in `[0, 29]` and
`row` in `[0, 17]`. The logical top-left corner of cell `(col, row)` is
`(BOARD_X + col * CELL, BOARD_Y + row * CELL)`, and its center is that point plus
half a cell on each axis.

The simulation runs entirely in these integer cell coordinates. A position
between two cells never occurs: every piece on the board occupies whole cells.

## Cell kinds

Every cell is exactly one of the following.

| Kind | What it is |
| --- | --- |
| Wall | A perimeter cell. Solid, and fatal to the head on contact. |
| Obstacle | An interior cell the mode has placed. Solid, and fatal to the head on contact. `specs/mode.md` fixes which cells, and there may be none. |
| Snake | A cell holding a segment of the snake, head or body. |
| Pellet | The cell holding the live pellet. |
| Empty | An unoccupied interior cell the snake may move through. |

## The wall border

The border is one cell thick on all four sides: row `0`, row `GRID_ROWS - 1`,
column `0`, and column `GRID_COLS - 1`. It leaves an interior of `28 x 16` cells,
`col` in `[1, 28]` and `row` in `[1, 16]`. An interior cell is any cell in that
range. The border is drawn for the whole round and never changes.

## The snake

The snake is a contiguous, non-branching chain of cells. Its first cell is the
head and the rest are body cells in order to the tail. The body always traces the
exact path the head has taken, with no gap and no branch.

A round starts the snake at `START_LENGTH` (`3`) cells, laid horizontally near
the center of the board and facing `right`.

| Cell | `(col, row)` |
| --- | --- |
| Head | `(15, 8)` |
| Body | `(14, 8)` |
| Tail | `(13, 8)` |

`specs/movement.md` fixes how the chain advances, grows, and collides.

## The pellet

Exactly one pellet is on the board at any moment during a round. It occupies a
single interior cell and is drawn one cell in size.

A pellet spawns at a uniformly random cell drawn from the valid set. A cell is
valid when all of the following hold.

- It is an interior cell.
- It holds no snake segment.
- It is not an obstacle cell.
- It is not the cell the current pellet occupies.

The first pellet of a round is placed after the snake is laid at its starting
cells, so it never lands under the starting chain. The board carries no pellet at
that moment, so every interior cell clear of the starting chain and of the
obstacles is in the set that first draw is made from, wherever the round before
it left its pellet.

When the head enters the pellet's cell the pellet is eaten: the snake grows, the
score resolves, and a new pellet spawns at once. `specs/movement.md` and
`specs/scoring.md` fix those two.

When the snake has grown until the valid set is empty, no pellet can spawn and
the round ends on the board-cleared win. `specs/ui.md` states that screen. The
board-cleared round leaves the board without a live pellet.
