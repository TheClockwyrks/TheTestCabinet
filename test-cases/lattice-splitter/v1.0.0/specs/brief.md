# Lattice Splitter — drawing brief

You are drawing the **Lattice splitter**, a **sprite sheet** for the Lattice
factory simulation. The splitter is a top-down **belt balancer**: it spans **two
tiles** across the flow — two belts in on one side, two belts out the other — and
balances the items running through it. Everything below describes the *device seen
from above*, with its belt surface animated like a running transport belt.

## The frames

- Each frame is its own **32×64-pixel** image with a transparent background.
  Origin is the top-left of the frame; `x` increases to the right, `y` increases
  downward. Coordinates are **within the frame** (0–63 in `y`, 0–31 in `x`).
- The sheet has **8 frames, numbered 0–7**. They are one continuous animation of
  the same splitter; only the belt surface moves between them.
- The frame is **32 wide × 64 tall = two stacked 32×32 tile cells**: a **top
  cell** at `y` 0–31 and a **bottom cell** at `y` 32–63. The splitter is one
  device occupying **both** cells.

## Orientation

Draw **one** orientation: the flow runs to the **right (East)**. Items travel
left-to-right across the frame; the two tile cells sit side by side across that
flow (stacked vertically in the frame). The renderer rotates this single
orientation for belts facing other directions — do not draw any other facing.

## What goes in each frame

Every frame shows the **same splitter** in the **same place**. What changes frame
to frame is the **belt surface scroll**:

- The belt surface is rows of **amber chevrons pointing East** (right), exactly
  like a Lattice transport belt's surface, covering both tile cells.
- Across the 8 frames the whole chevron surface **scrolls East by 4 pixels per
  frame**: frame 0 at offset 0, frame 1 at +4, frame 2 at +8 … frame 7 at +28.
  Because a chevron row repeats every **32 pixels**, 8 × 4 = 32 means frame 7
  hands back to frame 0 with **no jump** — a seamless loop. Make the surface wrap
  at the left/right edges so it also tiles horizontally with an adjoining belt.
- The **housing is static** — it sits in the same place in every frame. Only the
  belt surface underneath it moves.

So playing frames 0 → 7 reads as a running belt scrolling East through a balancer.

## The form

The splitter reads, at a glance, as **one two-tile machine with belt running
through it**, not as two separate belts:

- **Belt surface (moving):** the full 32×64 area is a transport-belt surface —
  dark belt metal with rows of amber chevrons pointing East. This is the layer
  that scrolls. Build it so both tile cells share the same continuous surface.
- **Housing (static, on top):** a grey-blue machine **frame** bracketing the two
  cells so they clearly read as **one 2-wide device** — a plate border around the
  outside of the 32×64 area and short brackets at the two ends (the input edge and
  the output edge across the flow). Leave the belt surface **visible through and
  between** the housing; the housing must not cover the whole surface.
- **Central divider (static):** a **seam running along the flow** (left-to-right,
  East–West) between the top and bottom cells, around `y` 31–32 — the line that
  marks where the two balanced lanes meet. This seam plus the housing is what
  separates the splitter from a plain belt.
- **Hazard accent:** a small **amber hazard-stripe** accent on the housing (amber
  on the dark outline), the way factory machines flag a moving part — a short
  touch, not the whole frame.

Keep the moving amber chevrons reading clearly over the dark belt metal in every
frame; the housing and divider sit on top as static structure.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Dark outline / shadow | `#1b1d21` |
| Belt metal — base | `#34383d` |
| Belt metal — mid | `#4a4f55` |
| Belt rail / edge highlight | `#6b7178` |
| Chevron (amber) — base | `#e6b329` |
| Chevron (amber) — highlight | `#f6d96b` |
| Chevron (amber) — shadow | `#b88410` |
| Housing (grey-blue) — light | `#6a7884` |
| Housing (grey-blue) — mid | `#4d5a64` |
| Housing (grey-blue) — dark | `#36424b` |

The **hazard-stripe accent** uses the amber `#e6b329` against the dark outline
`#1b1d21`. Do not introduce any other color.

## Working the tool

Build each frame up in sensible layers — first the dark belt-metal base across the
whole 32×64 area, then the scrolling amber chevron rows at this frame's offset,
then the static grey-blue housing border and end brackets, then the central
divider seam and the hazard-stripe accent. Draw into the frame you select with
`--frame <index>`, using plain in-frame coordinates. Run `draw-sheet --help` for
the available operations (filling and stroking circles and rectangles, lines,
single pixels, flood fill, and a horizontal mirror) and `draw-sheet <operation>
--help` for each one's exact flags. Call `draw-sheet` once per operation and read
`frames/<index>.png` between calls to judge that frame against this brief. A good
order is to finish frame 0 (the offset-0 chevrons plus the housing), check it,
then redraw each later frame with its chevrons shifted East by the right offset
while keeping the housing identical.
