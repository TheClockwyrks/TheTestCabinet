# Foray Maze Walls — drawing brief

You are drawing the **Foray maze wall tileset**, a **sprite sheet** for *Foray*,
a top-down ant-colony raiding game. The board is a tile-locked maze of dug soil
tunnels: two colonies raid across it for seeds and royal jelly. You are drawing
the **walls** of that maze in the classic rounded pac-man style (re-themed as
raised earthwork tunnel walls), plus the central **territory boundary** seam and
the **floor**. The renderer picks the right wall tile for each board cell from
its neighbors (an *autotile*), so your tiles must form a consistent, seamless
set.

These are **TILES, not sprites.** Each one fills its **entire 16×16 cell, edge to
edge** — designed to butt seamlessly against the tiles around it. Do **not**
center a little shape with a margin (that is for the creature sprites); a wall
tile's connected edges must reach the very border of the frame.

## The frames

- Each frame is its own **16×16-pixel** image. Origin is the top-left of the
  frame; `x` increases to the right, `y` increases downward. Coordinates are
  **within the frame** (0–15). You choose which frame an operation draws into
  with `--frame <index>`.
- The sheet has **20 frames, numbered 0–19**: the 16 autotile wall pieces (0–15),
  the boundary seam (16–18), and the floor (19).

### The wall autotile (frames 0–15)

The **frame index is a connection bitmask** of which of the four sides the wall
**continues** to (where a neighboring cell is also a wall):

- **N (up) = 1, E (right) = 2, S (down) = 4, W (left) = 8** — add the bits for
  the connected sides to get the frame index.

A **connected** side means the wall runs **flush to that edge** so it merges with
the wall in the neighboring cell — no rounded face there. An **open** (unset)
side means that edge faces a corridor: give it a **rounded, raised outer wall
face** against the floor. Draw all sixteen:

| Frame | Bits | Connected sides | Piece |
| --- | --- | --- | --- |
| 0 | – | none | isolated pillar (rounded on all four sides) |
| 1 | N | up | stub capped below, open left/right (bottom end of a vertical wall) |
| 2 | E | right | stub capped left (left end of a horizontal wall) |
| 3 | N+E | up, right | elbow — corridor turns (rounded on the lower-left) |
| 4 | S | down | stub capped above (top end of a vertical wall) |
| 5 | N+S | up, down | **vertical straight** (open left and right) |
| 6 | E+S | right, down | elbow (rounded on the upper-left) |
| 7 | N+E+S | up, right, down | **T-junction**, open to the left |
| 8 | W | left | stub capped right (right end of a horizontal wall) |
| 9 | N+W | up, left | elbow (rounded on the lower-right) |
| 10 | E+W | left, right | **horizontal straight** (open top and bottom) |
| 11 | N+E+W | up, right, left | **T-junction**, open downward |
| 12 | S+W | down, left | elbow (rounded on the upper-right) |
| 13 | N+S+W | up, down, left | **T-junction**, open to the right |
| 14 | E+S+W | right, down, left | **T-junction**, open upward |
| 15 | all | up, right, down, left | cross / fully-enclosed interior (flush all sides) |

The four elbows (3, 6, 9, 12) must be the **same corner piece rotated**, and the
four T-junctions (7, 11, 13, 14) the **same T rotated** — so corridors turn and
branch smoothly. The single most important property: the **wall thickness, the
rim, and where a connected edge meets the border are identical in every tile**,
so any two tiles that both connect on a shared edge line up with no jog or gap.

### The boundary seam (frames 16–18)

Down the middle of the board runs a **no-man's-land seam** dividing the two
colonies' halves — a neutral territory line, *not* a soil wall. It sits on the
floor and stacks vertically:

| Frame | Piece |
| --- | --- |
| 16 | seam **cap-top** — rounded top of the divider, floor above |
| 17 | seam **middle** — a vertical divider segment, tileable end-to-end |
| 18 | seam **cap-bottom** — rounded bottom of the divider, floor below |

Draw it as a slim central marker (e.g. a dashed/segmented line of boundary stakes
or a worn furrow) in the boundary color, centered left-to-right on a floor
background, clearly reading as a divider distinct from the walls. The middle (17)
must tile seamlessly above/below itself and join the caps.

### The floor (frame 19)

The **dug-tunnel floor** the whole maze sits on: a dark earthy ground filling the
cell, with a little subtle grain so it does not read as flat black, and
**seamless when repeated** (no edge line, no centered motif). The walls and seam
above are drawn against this same floor.

## Palette

The tileset is **shared and never recolored** — the same earth for both colonies.
Use only these colors:

| Role | Hex | Notes |
| --- | --- | --- |
| Wall fill | `#3a2a1c` | the main raised soil-wall body |
| Wall shadow | `#241a12` | darker soil for the wall's lower/under edge and crevices |
| Wall rim highlight | `#6b5030` | lighter warm soil along the raised top/open faces — the bevel that makes walls read as rounded |
| Floor | `#1b1410` | the dug-tunnel ground (darker than the walls) |
| Floor grain | `#241a12` | a few subtle specks in the floor |
| Boundary seam | `#4a3f2a` | the neutral central divider marker |
| Outline | `#0a0806` | fixed dark outline / deepest shadow |

The warm soil walls (`#3a2a1c` / `#6b5030`) must read as **raised** above the
darker dug **floor** (`#1b1410`); the seam (`#4a3f2a`) is its own neutral tone.
Do not use any other color — in particular **no red or blue**: the board is
earthy, and the colonies are the only saturated color elsewhere.

## Working the tool

The `draw-sheet` binary is the only way to make a mark. You draw into the frame
you select with `--frame <index>`, using plain in-frame coordinates (0–15). Run
`draw-sheet --help` for the available operations (filling and stroking circles
and rectangles, lines, single pixels, flood fill, and a horizontal mirror) and
`draw-sheet <operation> --help` for each one's exact flags. Call `draw-sheet`
once per operation and read `frames/<index>.png` between calls to judge that tile
against this brief.
