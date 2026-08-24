# Refract — The board

This file defines what a board is made of and where everything sits: the grid of
cells, the geometry that places a cell on the stage, the three kinds of node, the
three channels, and the notation a board is written in.

The rules a beam obeys are in `specs/beams.md`. How a player draws one is in
`specs/controls.md`. Every figure below carries the name this specification
gives it here.

## Cells

A board is a rectangular grid of cells. A cell is addressed as `(col, row)`, both
zero-indexed from the top-left, so `col` grows to the right and `row` grows
downward.

Each board declares its own `cols` and `rows`. `cols` is at least `1` and at most
`GRID_MAX_COLS` (`7`); `rows` is at least `1` and at most `GRID_MAX_ROWS` (`6`).

Every cell is either empty or holds exactly one node. An empty cell holds nothing
and is drawn as nothing, or as quiet background texture of the build's choosing.

## Where a cell sits

Adjacent cell centers are `CELL_PITCH` (`96`) apart on both axes, and the grid is
centered on `(BOARD_CX, BOARD_CY)` (`640, 392`) whatever its dimensions. The
center of a cell is:

- `cellX(col, cols) = BOARD_CX - (cols - 1) * CELL_PITCH / 2 + col * CELL_PITCH`
- `cellY(row, rows) = BOARD_CY - (rows - 1) * CELL_PITCH / 2 + row * CELL_PITCH`

A board of the largest size therefore spans `x` `352..928` and `y` `152..632` from
center to center, leaving room above the board for the heading and below it for
the footer described in `specs/ui.md`. A smaller board sits centered on the same
point, so the board never drifts as boards change.

Two radii govern a node:

| Constant | Value | Governs |
| --- | --- | --- |
| `NODE_R` | `30` | Every node's drawn form fits inside this radius of its cell center. |
| `NODE_HIT_R` | `44` | A node is targeted by the pointer when the pointer is within this radius of the node's cell center. |

`NODE_HIT_R` is below half of `CELL_PITCH` (`96`), which is `48`, so no two
targeting regions overlap and a pointer position targets at most one node.

## Nodes

There are three kinds of node.

| Kind | Meaning | Drawn as |
| --- | --- | --- |
| `emitter` | An endpoint of one channel's beam. | The **outlined** silhouette of its channel, in that channel's hue. |
| `lens` | A pass-through node belonging to one channel. | The **filled** silhouette of its channel, in that channel's hue. |
| `crystal` | A channel-neutral node carrying 1 to 3 charges, any of which any beam may spend. | A form clearly distinct from all three channel silhouettes, showing both its charge count and how many of those charges are currently spent. |

An emitter and a lens of the same channel share one silhouette and differ only by
outline against fill, so a player reads a node's channel and its role in the same
glance.

A crystal is never the property of a channel. It carries `charges`, a whole number
from `1` to `MAX_CHARGES` (`3`), and a running `spent` count from `0` to its
charges. The two read apart at a glance, so a player sees at once how much of a
crystal is still open. `specs/beams.md` says what spends a charge.

## Channels

`CHANNELS` holds the three channel identifiers in this order:

| Channel | Silhouette |
| --- | --- |
| `triangle` | A triangle. |
| `square` | A square. |
| `diamond` | A diamond, a square stood on a corner. |

Each channel carries one distinct hue, and the three are told apart at a glance.
The silhouettes are pinned, so channel identity reads by form as well as by hue
and a player who reads hue poorly still plays the board. The hues themselves are
the build's to choose.

A board declares **1 to 3 channels**. Every channel present has **exactly two
emitters** and any number of lenses, including none. A channel that is not
declared has no nodes on the board and no beam.

## Presentation is yours

Refract pins the geometry above, the node kinds, the channel silhouettes, and the
notation below. It does not pin a palette, a font, node artwork, beam rendering,
a background, or animation. The look of the optical bench is yours to design, and
a distinctive one is worth the effort.

What the look must deliver, because a player reads the board to play it:

1. The three channel hues are told apart at a glance.
2. Each channel's nodes carry that channel's silhouette, and an emitter reads as
   outlined against a lens's fill.
3. A crystal is never mistaken for a channel node, and its charges and its spent
   count are both readable without counting slowly.
4. Every node's drawn form fits inside `NODE_R` (`30`) of its cell center, so
   neighboring nodes never collide.
5. A drawn beam visibly connects the centers of the cells it links, so its route
   is unambiguous, and it carries its channel's hue.
6. Text is legible against whatever it is drawn on at the logical stage size.

## Board notation

A board is written as one row of characters per board row, read from the top-left
to the bottom-right, one character per cell. Every row of a board carries the same
number of characters, and that count is the board's `cols`; the number of rows is
its `rows`.

| Character | Cell |
| --- | --- |
| `.` | Empty. |
| `T` | Emitter of `triangle`. |
| `S` | Emitter of `square`. |
| `D` | Emitter of `diamond`. |
| `t` | Lens of `triangle`. |
| `s` | Lens of `square`. |
| `d` | Lens of `diamond`. |
| `1` | Crystal carrying 1 charge. |
| `2` | Crystal carrying 2 charges. |
| `3` | Crystal carrying 3 charges. |

For example, a board three cells wide and three tall, carrying the `triangle`
and `square` channels and one crystal:

```
T.S
1.s
T.S
```

The notation carries the board and nothing else. It records no beams and no
progress.
