# Coil — Maze mode

This file defines the game's mode: **Maze**, the grid-serpent run on a board laced
with a fixed course of fatal interior obstacles the snake must thread. It builds on
the board in `specs/playfield.md`, the simulation in `specs/mechanics.md`, the
produced assets in `specs/assets.md`, and the scoring and flow in `specs/flow.md`.

## Menu entry

This mode spec adds the `MAZE` entry to the main menu (see Game states in
`specs/flow.md`), at the top — above `HOW TO PLAY`:

- `MAZE`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a mode, and is always
shown last in the menu.)

## Mode

- **Maze** — the game on the fully enclosed `30 x 18` board from
  `specs/playfield.md`, with a fixed course of **interior obstacles** added. An
  **obstacle cell** is a board cell type (alongside the wall, empty, snake, and
  pellet cells in `specs/playfield.md`): solid and fatal on contact, just like a
  wall, turning the open board into a course the snake must thread. Exactly one
  pellet is on the board at a time.

Maze uses the tick interval (**125 ms**, see `specs/mechanics.md`), the
single-pellet placement (`specs/playfield.md`), the combo scoring
(`specs/mechanics.md` and `specs/flow.md`), and the collision and growth rules
exactly as those specs define them; the interior obstacles below are the one
addition.

### Obstacles

The obstacle cells are **fixed** for the whole round and are placed
**point-symmetrically** through the board center (about the point between cells
`(14, 8)` and `(15, 9)`), so the layout favors no direction. A cell `(col, row)`
maps to its mirror `(29 - col, 17 - row)`.

The obstacle cells are exactly these four bars (all coordinates are
`(col, row)`):

| Bar | Cells                                             |
| --- | ------------------------------------------------- |
| 1   | `(8,4) (9,4) (10,4) (11,4) (12,4) (13,4)`         |
| 2   | `(16,13) (17,13) (18,13) (19,13) (20,13) (21,13)` |
| 3   | `(8,10) (8,11) (8,12)`                            |
| 4   | `(21,5) (21,6) (21,7)`                            |

Bars 1 and 2 are mirrors of each other; bars 3 and 4 are mirrors of each other.
The snake's start row (`row = 8`) is deliberately clear of every obstacle, so it
has a free horizontal runway at the start.

- Draw obstacle cells in the obstacle color `#ffb454` with a soft glow, the same
  size as one cell. They are part of the board, not the snake.
- The head moving into any obstacle cell is **fatal**, exactly like a wall
  (see Collision in `specs/mechanics.md`).
- A pellet is never placed on an obstacle cell: obstacle cells are excluded from
  the set of valid pellet cells (see Placement in `specs/playfield.md`).
