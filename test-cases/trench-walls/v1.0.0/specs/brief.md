# Trench Walls — drawing brief

You are drawing the **Fathom trench tileset**, a **sprite sheet** for *Fathom*,
a bioluminescent deep-sea maze chase. The trench is a tile-locked maze of
flooded rock corridors: a glowing forager grazes them while predators hunt.
You are drawing the **walls** of that maze in the classic rounded pac-man style
(re-themed as raised deep-sea rock), plus the corridor **floor**, the unrevealed
**fog**, and the den **gate**. The renderer picks the right wall tile for each
board cell from its neighbors (an *autotile*), so your wall tiles must form a
consistent, seamless set.

These are **TILES, not sprites.** Each one fills its **entire 32×32 cell, edge to
edge** — designed to butt seamlessly against the tiles around it. Do **not**
center a little shape with a margin (that is for the creature sprites); a wall
tile's connected edges must reach the very border of the frame.

## The frames

- Each frame is its own **32×32-pixel** image. Origin is the top-left of the
  frame; `x` increases to the right, `y` increases downward. Coordinates are
  **within the frame** (0–31). You choose which frame an operation draws into
  with `--frame <index>`.
- The sheet has **19 frames, numbered 0–18**: the 16 autotile wall pieces (0–15),
  the floor (16), the fog (17), and the den gate (18).

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

### The floor (frame 16)

The **revealed corridor floor** — flooded open water — the whole maze sits on: a
dark watery ground filling the cell, with a little subtle grain so it does not
read as flat black, and **seamless when repeated** (no edge line, no centered
motif). The walls, fog, and gate are read against this same floor.

### The fog (frame 17)

The **unrevealed fog** tile: the pitch-dark trench before your light or a sonar
pulse has touched it. Fill the cell with the flat near-black fog color, edge to
edge — **featureless and even darker than the floor**, so an unrevealed tile
gives nothing away (you cannot tell wall from water under fog). No rim, no grain,
no shape: it is the indistinguishable dark.

### The den gate (frame 18)

The **den gate** the predators pass through: a corridor-floor tile crossed by a
**horizontal barred threshold** — a slim gate drawn in the rim-light color,
centered on the floor — that reads as a gateway distinct from a plain floor tile
and from the rock walls. It sits on the same floor as frame 16.

## Palette

The tileset is the trench itself. Use only these colors (the drawing is
regenerated pixel-for-pixel, so stray or off-palette colors and anti-aliased
fringes count against you):

| Role | Hex | Notes |
| --- | --- | --- |
| Wall rock | `#16293d` | the main raised rock-wall body |
| Wall rim light | `#24506b` | lighter rim along the raised top/open faces and rounded corners — the bevel that makes walls read as rounded; also the den-gate bars |
| Floor (open water) | `#0a1422` | the revealed corridor ground (darker than the walls) |
| Fog (unrevealed) | `#03060c` | the unrevealed dark; also the deepest shadow/outline along a wall's closed under-edges and crevices |

The rock walls (`#16293d` with a `#24506b` rim) must read as **raised** above the
darker open-water **floor** (`#0a1422`); the fog (`#03060c`) is the darkest of
all. A few sparse specks of the wall rock color in the floor make a subtle grain.
Do not use any other color — Fathom's trench is cold and near-black, and the
glowing creatures and plankton (drawn elsewhere) are the only bright color.

## Working the tool

Build each tile up in sensible layers — fill the wall body, lay the dark fog-color
shadow along the under/closed edges, then the lighter rim along the open faces and
rounded corners; for the floor and fog, the base fill then the grain (floor only);
for the gate, the floor then the bar — drawing into the frame you select with
`--frame <index>`, using plain in-frame coordinates (0–31). Run `draw-sheet --help`
for the available operations (filling and stroking circles and rectangles, lines,
single pixels, flood fill, and a horizontal mirror) and `draw-sheet <operation>
--help` for each one's exact flags. Call `draw-sheet` once per operation and read
`frames/<index>.png` between calls to judge that tile against this brief.

A good order: settle the wall **cross-section** first — decide the exact wall
thickness and rim, and where a connected edge meets the border — by drawing the
two straights (5, 10) and the interior (15); reuse those exact measurements for
every other tile so they line up. Then do the caps (1, 2, 4, 8), the elbows
(3, 6, 9, 12 — one corner mirrored/rotated four ways), the T-junctions
(7, 11, 13, 14), the isolated pillar (0), and finally the floor (16), the fog
(17), and the den gate (18).
