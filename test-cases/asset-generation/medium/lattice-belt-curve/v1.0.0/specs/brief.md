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
- **One continuous curved surface — a filled quarter-round, not a thin band.** The
  belt is the whole quarter-**disc** centred on the tile's **South-West corner**
  (`0, 31`): every pixel within 32 px of that corner is belt. So the surface **fills
  the tile solidly** and only the far **North-East corner** (around `31, 0`) — the
  region beyond 32 px from the corner — is left transparent (off-belt). Critically,
  the belt runs **all the way into the South-West corner**, so it reaches the full
  height of the West mouth and the full width of the South mouth. Do **not** hollow
  out an inner arc or leave a gap near the South-West corner — a curved *band* with
  an inner cutout would pull the surface back from the corner and **narrow both
  mouths below 32 px**, so it would no longer butt flush to a straight belt. The
  result reads as one belt bending smoothly from the West face round to the South
  face — **not** a straight segment, **not** two straight stubs meeting at a hard
  right angle, and **not** a thin ribbon following the corner.
- **Body:** the curved surface is dark metal built from the metal base tone with the
  metal mid tone worked into it, so it reads as a solid mechanical belt rather than a
  flat fill — the same body as the straight belt.
- **The one curved rail (the outer edge).** A curve has only **one** side rail: a
  lighter rail running along the **outer edge** — the convex arc sweeping from the
  top-left (`0, 0`, the top of the West mouth) round the outside to the bottom-right
  (`31, 31`, the East end of the South mouth). It is a thin band (roughly **2–3 px**)
  in the rail/edge highlight tone with the dark outline tone separating it from the
  belt surface — the curved analogue of a straight belt's outer side rail. The
  **inner side of the turn is the sharp South-West corner itself**, where the two
  mouths meet: do not put a rail arc there, because any inner rail would carve a
  cutout that narrows the mouths. Do **not** add a rail across the West or South
  faces either — those are open belt mouths, full width.
- **One belt, not two lanes.** The **whole filled quarter-round is one
  uninterrupted conveyor surface**, wide enough that two items ride side by side
  across it (one toward the sharp inner corner, one toward the outer arc). There is
  **no hard divider following the curve** and **no lane rails** — the only rail is
  the single outer-edge rail above. The chevrons (below) are **painted onto this
  surface** as movement markers; they do **not** carve out a lane or reserve a strip
  of their own.

## The moving surface — tread blades and chevrons

The belt sells its motion **two** ways, and **both scroll together** around the
arc: the **tread blades** patterned across the whole surface, and the **amber
chevrons** down the centre. The blades are the main "it is running" cue — a belt
whose surface holds still while only the arrows slide over it does not read as a
moving belt at all — and the chevrons say which way.

**Tread blades.** The conveyor surface is **not** a flat fill: it carries a
repeating run of **tread bars (cleats)** running **across** the belt, perpendicular
to travel. On the curve "across the belt" is **radial** — each blade is a short bar
aimed at the South-West corner (a spoke), spanning most of the belt width from near
the sharp inner corner out to just short of the outer rail. Draw them at a regular
**pitch** along the arc, a shade off the base — the metal mid tone for the raised
face of each cleat, the dark outline tone along one edge — so the surface reads as a
run of segments catching the overhead light. These blades **scroll around the arc
with the belt** (below); they are what make the surface itself look like it is
running.

**Chevrons.** A **single** row of **amber chevrons** — the direction markers — is
**painted onto the belt surface** down the **centre of the curve** (the mid-arc,
about 16 px from the South-West corner), pointing **in the direction of travel at
each point along the arc**. They ride on top of the tread blades and share the same
moving surface; they are **surface markings, not a structural lane**.

- A chevron is a small arrowhead: its **tip leads in the direction of travel** and
  its two arms open back **upstream**. Because the belt turns, the chevrons
  **rotate along the arc** — a chevron near the West entry **points East** (tip
  leading right, into the tile), and one near the South exit **points South** (tip
  leading down), with the chevrons in between aimed along the tangent of the curve
  as it bends from East round to South. Draw each in the amber mover tone, with the
  highlight tone on its leading edge and the shadow tone on its trailing edge so it
  reads with a little depth. Centre each chevron on the mid-arc — midway between the
  sharp inner corner and the outer rail — clear of the outer rail.
- Space the chevrons evenly along the curve at a regular **pitch** — the repeat
  distance from one chevron to the next, measured **along the arc**. **Do not aim
  for a particular number of chevrons:** how many fit follows from the pitch you
  pick and the length of the quarter arc, and the count is not what is judged. Pick
  a pitch that divides the arc **evenly** so the pattern advances cleanly and the
  loop is seamless.
- Pick the **tread-blade pitch** so the **chevron pitch is a whole multiple of it**
  (blades every 8 px of arc and chevrons every 16 px, say) — usually a blade or two
  between chevrons. Because the two share one factor, they advance as one locked
  pattern and both come back into register at the wrap, keeping the loop seamless.

### How the surface scrolls across the 8 frames

The eight frames are the same curved belt with the **whole surface pattern — the
tread blades and the chevrons together** — advanced **along the arc**. The chevron
pitch (a whole multiple of the blade pitch) is the repeat the offsets are measured
in, and the central requirement is that the surface **actually advances** — over
the loop the pattern travels a full chevron-pitch forward around the bend, it does
**not** flip back and forth between two positions:

- Shift the **whole surface pattern (blades and chevrons, locked together)** forward
  **along the curve** by exactly **one-eighth of the chevron pitch** each frame (it
  moves a little from the West entry toward the South exit, following the arc — not
  straight down or straight across). So across frames 0→7 the pattern steps forward
  by ⅛, ¼, ⅜ … ⅞ of a pitch, and after the wrap (frame 7 → frame 0) it has advanced
  **exactly one full chevron pitch**.
- Because the per-frame step is the pitch divided by the frame count, **every one
  of the eight frames sits at a distinct offset** — no two frames are alike, so the
  eye sees the blades and chevrons creeping steadily around the corner rather than
  two frames alternating in place. (A step of *half* the pitch, for example, would
  collapse the sheet into just two repeating images that oscillate — avoid that.)
- **Frame 7 must loop seamlessly back to frame 0**: after frame 7's offset the next
  ⅛-pitch step lands exactly one full pitch on, identical to frame 0's pattern, so
  playing 0→1→…→7→0 reads as one belt flowing steadily around the corner with no
  jump or backward slip. Because the chevron pitch is a whole number of blade
  pitches, the blades come back into register at the same wrap.
- A blade or chevron that scrolls off the **South exit** re-enters at the **West
  entry** by the same amount, so every frame is a full belt with the same pattern
  and no gap.

Only the **tile silhouette (its two mouths and outer outline) and the outer rail**
hold still frame to frame — they are the fixed belt structure, so the tile keeps its
shape and tiles seamlessly. **Everything on the surface — the tread blades and the
chevrons — scrolls together** around the arc. A frozen surface with only the arrows
moving is the failure to avoid.

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
