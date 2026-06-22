# Lattice Transport Belt — drawing brief

You are drawing the **Lattice transport belt**, a **sprite sheet** for a top-down
factory simulation. It is the animated surface the renderer draws for every
straight belt tile: a dark two-lane metal conveyor with side rails and amber
movers that scroll along the belt. Everything below describes that belt tile.

## Orientation — draw East only

Draw **one orientation**: the belt **flows to the right (East)**. Items travel
left→right, the chevrons point right, and the chevron pattern scrolls **rightward**
from frame to frame. Do not draw the North, South, or West belts — the renderer
rotates this single East-facing sprite for the other three directions.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background — one
  belt tile at Factorio normal resolution. Origin is the top-left of the frame;
  `x` increases to the right, `y` increases downward. Coordinates are **within the
  frame** (0–31) — there is no shared sheet to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The sheet
  has **8 frames, numbered 0–7**, and they form a single scrolling loop.

## The belt body (the same in every frame)

The belt is a top-down straight segment that **fills the whole 32×32 tile** edge
to edge — there is no transparent margin; the conveyor surface reaches every edge.

- **Body:** a dark-metal surface covering the tile, built from the metal base tone
  with a band of the metal mid tone so it reads as a solid mechanical belt rather
  than a flat fill.
- **Side rails:** a lighter rail along the **top edge** and a matching rail along
  the **bottom edge** of the tile (the rails that run alongside the direction of
  travel). Each rail is a thin horizontal band — roughly **2–3 px** tall — in the
  rail/edge highlight tone, with the dark outline tone separating it from the belt
  surface.
- **Two lanes:** the belt has **two independent lanes** — relative to travel a left
  lane and a right lane, which on this East-facing tile are the **top half** and
  the **bottom half** of the tile, split along the horizontal centre line (around
  `y = 16`). The split must read: mark it with the dark outline tone (and/or the
  metal mid tone) so the two lanes are visibly separate bands, each carrying its
  own row of chevrons, not one undivided belt.

## The chevrons (the movers that scroll)

Each lane carries a row of **amber chevrons** — the movers — that point **East**
(to the right), in the direction of travel.

- A chevron is a small right-pointing arrowhead: its **tip leads to the right**
  and its two arms open back to the **left**. Draw it in the amber mover tone,
  with the highlight tone on its leading/top edge and the shadow tone on its
  trailing/bottom edge so it reads with a little depth. Keep the chevrons inside
  the belt surface, clear of the top and bottom rails.
- Repeat the chevron along each lane so several show across the 32 px width, at
  **regular horizontal pitch of 8 px** (so a chevron's pattern repeats every 8 px).
  The top lane and the bottom lane each get their own row of these chevrons.

### How the pattern scrolls across the 8 frames

The eight frames are the same belt with the chevron pattern shifted to the right:

- From each frame to the next, shift the **whole chevron pattern right by exactly
  4 px**. So frame 0 has chevrons at one set of x positions, frame 1 the same
  pattern moved +4 px, frame 2 +8 px, and so on.
- Because the pattern repeats every 8 px and you shift 4 px per frame, the pattern
  returns to its start after 8 frames (8 × 4 = 32 px of travel). **Frame 7 must
  loop seamlessly back to frame 0** — playing 0→1→…→7→0 reads as one belt moving
  steadily to the right with no jump or backward slip.
- A chevron that scrolls **off the right edge re-enters from the left edge** by
  the same amount, so every frame is a full belt with no gap. This makes the
  segment **tile horizontally**: the left and right tile edges line up, so copies
  placed edge-to-edge look continuous with no seam in the body, the rails, or the
  chevron rows.

The belt body and the side rails do **not** move — only the chevron pattern
scrolls.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Dark outline / shadow | `#1b1d21` |
| Belt metal base | `#34383d` |
| Belt metal mid | `#4a4f55` |
| Rail / edge highlight | `#6b7178` |
| Mover / chevron (amber) | `#e6b329` |
| Mover highlight | `#f6d96b` |
| Mover shadow | `#b88410` |

## Working the tool

Build each frame up in sensible layers — fill the metal body, lay in the metal-mid
band and the two side rails, mark the centre split between the two lanes, then draw
the row of amber chevrons in each lane — drawing into the frame you select with
`--frame <index>`, using plain in-frame coordinates (0–31). Run `draw-sheet
--help` for the available operations (filling and stroking circles and rectangles,
lines, single pixels, and flood fill) and `draw-sheet <operation> --help` for each
one's exact flags. Call `draw-sheet` once per operation and read
`frames/<index>.png` between calls to judge that frame against this brief. A good
order is to finish the belt body and rails once, then place each frame's chevrons
shifted 4 px further right than the last, checking that frame 7 lines up with
frame 0.
