# Lattice Transport Belt — drawing brief

You are drawing the **Lattice transport belt**, a **sprite sheet** for Lattice,
a grid-based factory simulation rendered in a high-angle, pseudo-3D style.
The belt is the **flat, ground-level** layer of that world — the animated
surface the renderer draws for every straight belt tile: a **single** conveyor
belt — dark metal with side rails and a **central** row of amber movers **painted
on it** to show the direction of travel. It is **one continuous surface**, wide
enough that **two items ride side by side and together span its full width**. It
sits in the ground plane (the machines above it carry the visible height), so you
draw it essentially from straight above. Everything below describes that belt tile.

## Orientation — draw East only

Draw **one orientation**: the belt **flows to the right (East)**. Items travel
left→right, the chevrons point right, and the chevron pattern scrolls **rightward**
from frame to frame. Do not draw the North, South, or West belts — the renderer
rotates this single East-facing sprite for the other three directions.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background — one
  belt tile at the game's normal tile resolution. Origin is the top-left of the frame;
  `x` increases to the right, `y` increases downward. Coordinates are **within the
  frame** (0–31) — there is no shared sheet to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The sheet
  has **8 frames, numbered 0–7**, and they form a single scrolling loop.

## The belt body (the same in every frame)

The belt is a top-down straight segment that **fills the whole 32×32 tile** edge
to edge — there is no transparent margin; the conveyor surface reaches every edge.
Its **32 px width across the direction of travel is the standard belt width**: it
is exactly the width of a **single splitter input** (one 32 px cell of the two-tile
Lattice splitter), so a belt and the machines it connects to line up **flush, edge
to edge**. Draw the belt neither wider nor narrower than the full tile — a belt
must butt up to a splitter mouth with no overhang or gap.

- **Body:** a dark-metal surface covering the tile, built from the metal base tone
  with a band of the metal mid tone so it reads as a solid mechanical belt rather
  than a flat fill.
- **Side rails:** a lighter rail along the **top edge** and a matching rail along
  the **bottom edge** of the tile (the rails that run alongside the direction of
  travel). Each rail is a thin horizontal band — roughly **2–3 px** tall — in the
  rail/edge highlight tone, with the dark outline tone separating it from the belt
  surface.
- **One continuous surface:** this is a **single** belt, **not** two belts side by
  side. The **entire area between the two side rails is one uninterrupted conveyor
  surface**. It is wide enough that two items sit **side by side across it**, and
  together they take up the **whole width** of the belt — one toward the top, one
  toward the bottom, meeting in the middle. Do **not** split the tile into two:
  there is **no hard divider line down the middle** and **no inner rails**, and the
  only rails are the outer top and bottom side rails. The chevrons (below) are
  **painted onto this surface** as movement markers — they do **not** carve out a
  lane or reserve a strip of their own, and the surface where they sit is the **same**
  surface the items rest on. An item is not confined to a narrow top or bottom band:
  the two side-by-side items span the full surface between the rails.

## The moving surface — tread blades and chevrons

The belt sells its motion **two** ways, and **both scroll together** to the right:
the **tread blades** patterned across the whole surface, and the **amber chevrons**
down the centre. The blades are the main "it is running" cue — a belt whose surface
holds still while only the arrows slide over it does not read as a moving belt at
all — and the chevrons say which way.

**Tread blades.** The conveyor surface is **not** a flat fill: it carries a
repeating run of **tread bars (cleats)** running **across** the belt — short
**vertical** bars spanning the full height between the top and bottom rails,
perpendicular to the East–West travel. Draw them at a regular **pitch** along the
belt, a shade off the base — the metal mid tone for the raised face of each cleat,
the dark outline tone along one edge — so the surface reads as a run of segments
catching the overhead light. These blades **scroll east with the belt** (below);
they are what make the surface itself look like it is running.

**Chevrons.** A **single** row of **amber chevrons** — the direction markers — is
**painted onto the belt surface** down the **centre** of the belt, along the tile's
horizontal centre line, pointing **East** (to the right), in the direction of
travel. They ride on top of the tread blades and share the same moving surface;
they are **surface markings, not a structural lane**. There is **one central row**
shared by the whole belt — **not** a separate row of chevrons per side — and the
surface under and around them is the **same continuous surface** items rest on,
which spans the full width between the rails. The chevrons do **not** reserve a band
of their own or split the belt into rows.

- A chevron is a small right-pointing arrowhead: its **tip leads to the right**
  and its two arms open back to the **left**. Draw it in the amber mover tone,
  with the highlight tone on its leading/top edge and the shadow tone on its
  trailing/bottom edge so it reads with a little depth. **Centre each chevron on
  the tile's horizontal centre line**, clear of the top and bottom rails. Do **not**
  leave a reserved empty band around the chevrons — they are painted directly on the
  full belt surface.
- Space the chevrons evenly along the belt at a regular **pitch** — the repeat
  distance from one chevron to the next, measured **along the direction of travel**
  (East–West). **Do not aim for a particular number of chevrons:** how many fit
  across the tile follows from the pitch you pick and the 32 px width, and the
  count is not what is judged. Pick a pitch that divides the 32 px tile **evenly**
  so the pattern tiles edge-to-edge — **16 px is a good choice** (32 px also
  works). This one central row carries the chevrons at that pitch.
- Pick the **tread-blade pitch** so the **chevron pitch is a whole multiple of it**
  (blades every 8 px and chevrons every 16 px, say) — usually a blade or two between
  chevrons. Because the two share one factor, they advance as one locked pattern and
  both come back into register at the wrap, keeping the loop seamless.

### How the surface scrolls across the 8 frames

The eight frames are the same belt with the **whole surface pattern — the tread
blades and the chevrons together** — advanced to the right. The chevron pitch (a
whole multiple of the blade pitch) is the repeat the offsets are measured in, and
the central requirement is that the surface **actually advances** — over the loop
the pattern travels a full chevron-pitch forward, it does **not** flip back and
forth between two positions:

- Shift the **whole surface pattern (blades and chevrons, locked together)** right
  by exactly **one-eighth of the chevron pitch** each frame. So across frames 0→7
  the pattern steps forward by ⅛, ¼, ⅜ … ⅞ of a pitch, and after the wrap (frame 7 →
  frame 0) it has advanced **exactly one full chevron pitch**. With a 16 px pitch
  that is a clean **2 px per frame**; with a 32 px pitch, 4 px per frame.
- Because the per-frame step is the pitch divided by the frame count, **every one
  of the eight frames sits at a distinct offset** — no two frames are alike, so
  the eye sees the blades and chevrons creeping steadily forward rather than two
  frames alternating in place. (A step of *half* the pitch, for example, would
  collapse the sheet into just two repeating images that oscillate — avoid that.)
- **Frame 7 must loop seamlessly back to frame 0**: after frame 7's offset the
  next ⅛-pitch step lands exactly one full pitch on, which is identical to frame
  0's pattern, so playing 0→1→…→7→0 reads as one belt moving steadily to the right
  with no jump or backward slip. Because the chevron pitch is a whole number of
  blade pitches, the blades come back into register at the same wrap.
- A blade or chevron that scrolls **off the right edge re-enters from the left
  edge** by the same amount, so every frame is a full belt with no gap. This makes
  the segment **tile horizontally**: the left and right tile edges line up, so
  copies placed edge-to-edge look continuous with no seam in the body, the rails, or
  the surface pattern.

Only the **side rails and the tile's outline** hold still frame to frame — they are
the fixed belt structure, so the tile keeps its shape and tiles seamlessly.
**Everything on the surface — the tread blades and the chevrons — scrolls together**
to the right. A frozen surface with only the arrows moving is the failure to avoid.

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
