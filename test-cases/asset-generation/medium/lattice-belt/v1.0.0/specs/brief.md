# Lattice Transport Belt — drawing brief

You are drawing the **Lattice transport belt**, a **sprite sheet** for Lattice,
a Factorio-style factory simulation rendered in a high-angle, pseudo-3D style.
The belt is the **flat, ground-level** layer of that world — the animated
surface the renderer draws for every straight belt tile: a dark two-lane metal
conveyor with side rails and amber movers that scroll along the belt. It sits in
the ground plane (the machines above it carry the visible height), so you draw
it essentially from straight above. Everything below describes that belt tile.

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
  the **bottom half** of the tile, split along the horizontal centre line. The
  split must read: mark it with the dark outline tone (and/or the
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
- Space the chevrons evenly along each lane at a regular **pitch** — the repeat
  distance from one chevron to the next. **Do not aim for a particular number of
  chevrons:** how many fit across the tile follows from the pitch you pick and the
  32 px width, and the count is not what is judged. Pick a pitch that divides the
  32 px tile **evenly** so the pattern tiles edge-to-edge — **16 px is a good
  choice** (32 px also works). The top lane and the bottom lane each carry their
  own row of these chevrons at the same pitch.

### How the pattern scrolls across the 8 frames

The eight frames are the same belt with the chevron pattern advanced to the right,
and the central requirement is that the pattern **actually advances** — over the
loop a chevron travels a full pitch forward, it does **not** flip back and forth
between two positions:

- Shift the whole chevron pattern right by exactly **one-eighth of the pitch**
  each frame. So across frames 0→7 the pattern steps forward by ⅛, ¼, ⅜ … ⅞ of a
  pitch, and after the wrap (frame 7 → frame 0) it has advanced **exactly one full
  pitch**. With a 16 px pitch that is a clean **2 px per frame**; with a 32 px
  pitch, 4 px per frame.
- Because the per-frame step is the pitch divided by the frame count, **every one
  of the eight frames sits at a distinct offset** — no two frames are alike, so
  the eye sees a chevron creeping steadily forward rather than two frames
  alternating in place. (A step of *half* the pitch, for example, would collapse
  the sheet into just two repeating images that oscillate — avoid that.)
- **Frame 7 must loop seamlessly back to frame 0**: after frame 7's offset the
  next ⅛-pitch step lands exactly one full pitch on, which is identical to frame
  0's pattern, so playing 0→1→…→7→0 reads as one belt moving steadily to the right
  with no jump or backward slip.
- A chevron that scrolls **off the right edge re-enters from the left edge** by
  the same amount, so every frame is a full belt with no gap. This makes the
  segment **tile horizontally**: the left and right tile edges line up, so copies
  placed edge-to-edge look continuous with no seam in the body, the rails, or the
  chevron rows.

The belt body and the side rails do **not** move — only the chevron pattern
scrolls.

## Palette

Use only these colors:

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

The `draw-sheet` binary is the only way to make a mark. You draw into the frame
you select with `--frame <index>`, using plain in-frame
coordinates (0–31). Run `draw-sheet --help` for the available operations (filling
and stroking circles and rectangles, lines, single pixels, and flood fill) and
`draw-sheet <operation> --help` for each one's exact flags. Call `draw-sheet` once
per operation and read `frames/<index>.png` between calls to judge that frame
against this brief.
