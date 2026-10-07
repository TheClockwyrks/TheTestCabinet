# Wireworm — The board

This file defines the geometry every other rule is written against: the two
regions the stage is divided into, the tile grid the board is laid out on, the
map between a tile and the stage, the player band the cursor is confined to, and
the row the worm enters along. Every figure below carries the name this
specification gives it here.

## The two regions

The `1280 x 720` stage is split into two regions, stacked.

| Region  | Extent                                                                              | Holds                                    |
| ------- | ----------------------------------------------------------------------------------- | ---------------------------------------- |
| HUD bar | `x` in `[0, 1280]`, `y` in `[0, HUD_H]` (`80`)                                      | The three readouts `specs/ui.md` states. |
| Board   | `x` in `[0, BOARD_W]` (`1280`), `y` in `[BOARD_Y, BOARD_Y + BOARD_H]` (`[80, 720]`) | Everything play consists of.             |

The HUD bar's three readouts are drawn inside the HUD bar. No node, worm
segment, foe, or bolt is drawn in it: play is confined to the board region
beneath it.

## The tile grid

The board is a grid of square tiles, `COLS` (`40`) across by `ROWS` (`20`) down,
each `TILE` (`32`) units square. A tile is addressed as `(c, r)`, both
zero-indexed from the board's top-left, so `c` grows to the right and `r` grows
downward.

Each tile holds at most one node, and each worm segment occupies one tile
exactly. The cursor, the foes, and the bolts move in logical units over the grid
rather than snapping to it.

## The tile-to-stage map

A tile's corner and its center on the stage:

```
tileLeft(c) = TILE * c
tileTop(r)  = BOARD_Y + TILE * r
tileCX(c)   = TILE * c + TILE / 2
tileCY(r)   = BOARD_Y + TILE * r + TILE / 2
```

Tile `(c, r)` therefore spans `x` in `[32c, 32c + 32]` and `y` in
`[80 + 32r, 80 + 32r + 32]`, and its center is at `(32c + 16, 80 + 32r + 16)`.
A node fills its tile and is drawn centered on that point, and so is a worm
segment.

The inverse, which is how the tile an entity occupies is read from its center:

```
c = floor(x / TILE)
r = floor((y - BOARD_Y) / TILE)
```

A tile lies on the board when `inBounds(c, r)`, which is `0 <= c < COLS` and
`0 <= r < ROWS`.

## The rows that matter

| Row           | Name             | Role                                                                  |
| ------------- | ---------------- | --------------------------------------------------------------------- |
| `0`           | The entry row    | The row a level's worm enters along, as `specs/worm.md` states.       |
| `1` to `17`   | The scatter rows | The rows a new run scatters nodes across, as `specs/nodes.md` states. |
| `18` and `19` | The player band  | The two rows the cursor is confined to.                               |
| `19`          | The floor        | The bottom row of the board.                                          |

## The player band

The player band is the bottom two rows of the grid, rows `BAND_TOP_ROW` (`18`)
and `19`, spanning `y` in `[BAND_TOP_Y, 720]` (`[656, 720]`) across the full
width of the board.

The cursor's center is clamped to the band's four bounds:

| Bound                 | Constant       | Value  |
| --------------------- | -------------- | ------ |
| Leftmost center `x`   | `CURSOR_X_MIN` | `16`   |
| Rightmost center `x`  | `CURSOR_X_MAX` | `1264` |
| Topmost center `y`    | `CURSOR_Y_MIN` | `672`  |
| Bottommost center `y` | `CURSOR_Y_MAX` | `704`  |

The vertical bounds are the centers of rows `18` and `19`, so the band gives the
cursor `32` units of vertical travel and the full width horizontally. The band's
center is `(640, 688)`. What the cursor does inside those bounds is in
`specs/cursor.md`.
