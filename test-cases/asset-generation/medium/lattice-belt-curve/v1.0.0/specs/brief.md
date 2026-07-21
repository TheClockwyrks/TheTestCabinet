# Lattice Curved Transport Belt — drawing brief

You are drawing the **Lattice curved transport belt**, a **sprite sheet** for
Lattice, a grid-based factory simulation rendered in a high-angle, pseudo-3D
style. This is the **corner** piece of the belt system: a single tile where a
belt **turns 90 degrees** while staying **one continuous belt**. It is the same
belt as the straight **transport belt** — the same dark-metal
surface with side rails and a **central row of amber movers painted on it** to
show the direction of travel — only bent through a quarter turn. Like the straight
belt it is the **flat, ground-level** layer of the world, so you draw it
essentially from straight above. Everything below describes that one corner tile.

## Orientation — draw one canonical curve

Draw **one orientation** of the corner: flow **enters at the West edge** (from the
left, travelling East) and **turns to leave at the South edge** (out the bottom,
travelling South) — a single 90-degree **right-hand** turn, curving clockwise. The
renderer rotates and mirrors this one sprite to make the other seven corners (the
four rotations and their left-hand mirror images), so you draw **only** this
West-in / South-out curve. Do not draw any other corner, and do not draw a
straight belt.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background — one
  belt tile at the game's normal tile resolution, the **same tile size as the
  straight belt** so a curve butts flush against one. Origin is the top-left of the
  frame; `x` increases to the right, `y` increases downward. Coordinates are
  **within the frame** (0–31).
- You choose which frame an operation draws into with `--frame <index>`. The sheet
  has **8 frames, numbered 0–7**, and they form a single scrolling loop.

## The curve (the same in every frame)

The belt sweeps a **quarter turn** across the tile, connecting two of its edges:

- **A full-width face at each connected edge.** The belt meets the **West edge**
  (the whole left edge, `x = 0`, `y = 0`–`31`) with its full **32 px** width, and
  meets the **South edge** (the whole bottom edge, `y = 31`, `x = 0`–`31`) with its
  full **32 px** width. These are the two faces a neighboring straight belt or
  machine mouth butts against, so each must be the **full belt width, edge to
  edge** — no overhang and no gap, exactly as a straight belt's 32 px face.
- **One continuous curved surface.** Between those two faces the surface follows a
  **90-degree arc** centred on the tile's **South-West corner** (`0, 31`): every
  point of the belt is within the tile and within 32 px of that corner. So the
  surface fills the tile **except the far North-East corner** (around `31, 0`),
  which lies outside the arc and is left transparent (off-belt). The result reads
  as one belt bending smoothly from the West face round to the South face — **not**
  a straight segment, and **not** two straight stubs meeting at a hard right angle.
- **Body:** the curved surface is a dark-metal band built from the metal base tone
  with the metal mid tone worked into it, so it reads as a solid mechanical belt
  rather than a flat fill — the same body as the straight belt.
- **Rails:** a lighter rail runs along the **outer edge** of the curve — the wide
  arc sweeping from the top-left (`0, 0`, the top of the West face) round the
  outside to the bottom-right (`31, 31`, the East end of the South face) — and a
  matching rail runs along the **inner edge** of the curve — the tight arc hugging
  the South-West corner. Each rail is a thin band (roughly **2–3 px**) in the
  rail/edge highlight tone with the dark outline tone separating it from the belt
  surface. These are the curved analogue of the straight belt's top and bottom side
  rails; do **not** add any rail across the West or South faces themselves — those
  are open belt mouths.
- **One belt, not two lanes.** The **entire area between the inner and outer rails
  is one uninterrupted conveyor surface**, wide enough that two items ride side by
  side across it (one toward the inner edge, one toward the outer). There is **no
  hard divider following the curve** and **no inner lane rails** — the only rails
  are the inner and outer edge rails. The chevrons (below) are **painted onto this
  surface** as movement markers; they do **not** carve out a lane or reserve a strip
  of their own.

## The chevrons (the movers that scroll)

A **single** row of **amber chevrons** — the movers — is **painted onto the belt
surface** down the **centre of the curve** (the mid-arc, about 16 px from the
South-West corner), pointing **in the direction of travel at each point along the
arc**. Their only job is to show that the belt is moving and which way; they are
**surface markings, not a structural lane**.

- A chevron is a small arrowhead: its **tip leads in the direction of travel** and
  its two arms open back **upstream**. Because the belt turns, the chevrons
  **rotate along the arc** — a chevron near the West entry **points East** (tip
  leading right, into the tile), and one near the South exit **points South** (tip
  leading down), with the chevrons in between aimed along the tangent of the curve
  as it bends from East round to South. Draw each in the amber mover tone, with the
  highlight tone on its leading edge and the shadow tone on its trailing edge so it
  reads with a little depth. Centre each chevron on the mid-arc, clear of the inner
  and outer rails.
- Space the chevrons evenly along the curve at a regular **pitch** — the repeat
  distance from one chevron to the next, measured **along the arc**. **Do not aim
  for a particular number of chevrons:** how many fit follows from the pitch you
  pick and the length of the quarter arc, and the count is not what is judged. Pick
  a pitch that divides the arc **evenly** so the pattern advances cleanly and the
  loop is seamless.

### How the pattern scrolls across the 8 frames

The eight frames are the same curved belt with the chevron pattern advanced
**along the arc**, and the central requirement is that the pattern **actually
advances** — over the loop a chevron travels a full pitch forward around the bend,
it does **not** flip back and forth between two positions:

- Shift the whole chevron pattern forward **along the curve** by exactly
  **one-eighth of the pitch** each frame (the West-entry chevrons move a little
  toward the South exit, following the arc — not straight down or straight across).
  So across frames 0→7 the pattern steps forward by ⅛, ¼, ⅜ … ⅞ of a pitch, and
  after the wrap (frame 7 → frame 0) it has advanced **exactly one full pitch**.
- Because the per-frame step is the pitch divided by the frame count, **every one
  of the eight frames sits at a distinct offset** — no two frames are alike, so the
  eye sees a chevron creeping steadily around the corner rather than two frames
  alternating in place. (A step of *half* the pitch, for example, would collapse
  the sheet into just two repeating images that oscillate — avoid that.)
- **Frame 7 must loop seamlessly back to frame 0**: after frame 7's offset the next
  ⅛-pitch step lands exactly one full pitch on, identical to frame 0's pattern, so
  playing 0→1→…→7→0 reads as one belt flowing steadily around the corner with no
  jump or backward slip.
- A chevron that scrolls off the **South exit** re-enters at the **West entry** by
  the same amount, so every frame is a full belt with the same number of chevrons
  and no gap in the row.

The belt body and the rails do **not** move — only the chevron pattern scrolls.

## Palette

Use only these colors — the **same palette as the straight belt**, so a curve and
a straight belt read as one continuous conveyor:

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
you select with `--frame <index>`, using plain in-frame coordinates (0–31). Run
`draw-sheet --help` for the available operations (filling and stroking circles and
rectangles, lines, single pixels, and flood fill) and `draw-sheet <operation>
--help` for each one's exact flags. A quarter-disc surface is well suited to a
filled circle centred on the South-West corner clipped to the tile, with the inner
cutout and rails drawn over it; the chevrons are then painted along the mid-arc.
Call `draw-sheet` once per operation and read `frames/<index>.png` between calls to
judge that frame against this brief.
