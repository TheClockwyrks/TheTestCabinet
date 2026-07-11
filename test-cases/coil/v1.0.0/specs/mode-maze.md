# Coil — Maze mode

This file defines this build's one playable mode, **Maze**, and its main-menu
entry. It builds on the board in `specs/playfield.md`, the simulation in
`specs/mechanics.md`, and the scoring and flow in `specs/flow.md`.

## Menu entry

This spec adds the following entry to the main menu (see Game states in
`specs/flow.md`), before `HOW TO PLAY`:

- `MAZE`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a mode, and is always
shown last in the menu.)

## Maze

- **Maze** — the game on the fully enclosed `30 x 18` board from
  `specs/playfield.md` (solid, fatal perimeter walls; interior playable area
  `28 x 16`), with a set of **fixed interior obstacles** added. Obstacle cells are
  solid and fatal on contact, just like walls, turning the open board into a
  course the snake must thread.

Maze uses the 125 ms tick interval (`specs/mechanics.md`), the standard
single-pellet placement (`specs/playfield.md`), the combo scoring
(`specs/mechanics.md` and `specs/flow.md`), and the standard collision and growth
rules — with the interior obstacles below added.

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

- Draw obstacle cells in the maze-obstacle color with a soft glow, the same size
  as one cell. They are part of the board, not the snake.
- The head moving into any obstacle cell is **fatal**, exactly like a wall
  (see Collision in `specs/mechanics.md`).
- A pellet is never placed on an obstacle cell: obstacle cells are excluded from
  the set of valid pellet cells (see Placement in `specs/playfield.md`).

Walls, tick rate, single-pellet placement, combo scoring, growth, and the
body/tail collision rule are all as defined in the common specs; Maze only adds
the fatal interior obstacle cells.
