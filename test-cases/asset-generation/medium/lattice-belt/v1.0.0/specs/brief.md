# Lattice Transport Belt — drawing brief

You are drawing the **Lattice transport belt**, a **sprite sheet** for Lattice, a
grid-based factory simulation drawn **flat and top-down** — a clean 2D world seen
from straight above. The belt is the **ground-level** layer of that world — the
animated surface the renderer draws under every belt tile — so you draw it from
straight above, as a flat 2D surface.

The belt exists in **two forms** and **three tiers**, and this one sheet carries
all of them:

- the **straight** belt, which runs across a tile, and
- the **curve**, where the same belt turns 90 degrees,

each drawn at **three tiers** — a base belt, a faster reinforced belt, and the
fastest, most advanced belt. Every tier is **the same belt**, built from one
construction language; the tiers are upgrades of a single machine, not three
different belts. In a running factory a straight belt feeds a curve and a curve
feeds a straight belt, tile against tile, and each tier has to read as a **single
conveyor changing direction** — and a player has to see at a glance that all three
tiers are the same belt, only progressively upgraded. Drawing the forms so they
are unmistakably one machine, so they physically join, and so the three tiers read
as one family that steps up in speed and refinement, is the substance of this
brief.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background — one
  belt tile at the game's normal tile resolution. Origin is the top-left of the
  frame; `x` increases to the right, `y` increases downward. Coordinates are
  **within the frame** (0–31) — there is no shared sheet to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **48 frames, numbered 0–47**, in three tiers of sixteen, each tier
  split into two eight-frame loops:

  | Frames    | Tier   | Form              | Flow                      |
  | --------- | ------ | ----------------- | ------------------------- |
  | `0`–`7`   | Tier 1 | the straight belt | enters West, leaves East  |
  | `8`–`15`  | Tier 1 | the curve         | enters West, leaves South |
  | `16`–`23` | Tier 2 | the straight belt | enters West, leaves East  |
  | `24`–`31` | Tier 2 | the curve         | enters West, leaves South |
  | `32`–`39` | Tier 3 | the straight belt | enters West, leaves East  |
  | `40`–`47` | Tier 3 | the curve         | enters West, leaves South |

- Each group of eight is a **single scrolling loop**.

## The three tiers

The three tiers are the **same belt at successively higher throughput**. What
changes from one tier to the next is exactly three things — the **accent color**,
the **amount of mechanical detail**, and the **playback speed** — and nothing
else. The metal body, the cross-section, the silhouette, and the whole
construction language stay identical, so a higher tier is unmistakably the same
belt, only upgraded.

| Tier   | Accent (mover) | Mechanical detail                                                                              | Speed   |
| ------ | -------------- | ---------------------------------------------------------------------------------------------- | ------- |
| Tier 1 | amber          | the base belt — plain rails, one tread run, one chevron row                                    | base    |
| Tier 2 | red-orange     | reinforced — a bolt/rib line worked into each rail, a finer tread                              | faster  |
| Tier 3 | blue-cyan      | the most advanced — the densest tread and rail detail, a subtle energy glow along the chevrons | fastest |

- **Accent color.** The **movers** — the tread-blade catch-lights and the chevrons
  — carry the tier's accent color (amber, then red-orange, then blue-cyan), using
  that tier's mover / highlight / shadow tones from the palette. The dark metal
  body, the rails, and the outline are the **same tones in every tier**; only the
  movers are recolored. A glance at the accent color alone tells the tiers apart.
- **Mechanical detail rises tier to tier.** Tier 1 is the plainest form. Tier 2
  adds reinforcement — a line of bolt studs or a raised rib worked into each rail,
  and a finer tread (a secondary bar or a tighter blade face) — drawn onto the
  **same** cross-section, never widening the rails or the surface. Tier 3 is the
  densest and most refined: the finest tread and rail detailing plus a **subtle
  energy glow** (a thin bloom of the tier's highlight tone) running along the
  chevron row. Each step adds richness without changing the belt's shape.
- **Higher tiers run faster.** Each tier is drawn as its own pair of eight-frame
  loops, built identically; the renderer plays a higher tier's loop back at a
  higher rate, so the upgrade reads as a faster belt. You do not change the
  per-frame drawing to convey speed — draw each tier's loop the same way, and the
  playback does the rest.

The added detail must obey every rule the base belt does: it must **tile
horizontally** on the straight belt, **join flush** at the curve's mouths within
its tier, and — if it sits on the surface — **scroll** with everything else.

## Orientation — one straight, one curve, per tier

Draw **one orientation of each form**, for each tier. The straight belt **flows to
the right (East)**: items travel left→right and the surface scrolls rightward. The
curve **enters at the West edge travelling East and leaves at the South edge
travelling South** — a single 90-degree right-hand turn, curving clockwise.

The renderer rotates and mirrors these sprites to produce every other direction
and corner, so draw **only** the East-flowing straight belt and **only** the
West-in / South-out curve, for each tier. Do not draw the other directions or the
other corners.

## The shared construction language

Everything in this section is **one vocabulary used by every form and every
tier**. A curve that is drawn with different rails, a different blade rhythm, or
different tones than the straight belt is wrong even if it looks perfectly good on
its own — and so is a tier that changes the belt's body, cross-section, or blade
pattern rather than only its accent color and its level of detail.

**The palette.** Every form and tier uses only the colors in the table at the end
of this brief, with the same role for each tone: the same tone is the metal base
throughout, the same tone is the rail throughout, and each tier's mover uses its
own amber, red-orange, or blue-cyan trio in the mover / highlight / shadow roles,
with the highlight and shadow on the same side of a chevron everywhere.

**The cross-section.** Cut across the belt, perpendicular to the direction of
travel, and you get the belt's cross-section: a **rail** band at each edge, a
**dark outline** separating each rail from the surface, and the **conveyor
surface** filling everything between them. Choose this cross-section once — how
many pixels of rail, how many of outline, where the surface begins and ends — and
use the **identical** cross-section in every form and every tier. A rail band of
roughly **2–3 px** reads well at this size. The belt fills its tile edge to edge:
the cross-section spans the full **32 px**, which is the standard belt width and
exactly the width of a **single splitter input**, so a belt and the machines it
connects to line up flush. Tier 2's and tier 3's added reinforcement is drawn
**within** this same rail band — it must not make the rails or surface wider.

**The tread blades.** The conveyor surface is **not** a flat fill: it carries a
repeating run of **tread bars (cleats)** running **across** the belt,
perpendicular to the direction of travel, spanning the surface between the rails.
Each blade is a raised face in the metal mid tone with the dark outline tone down
one edge, so the surface reads as a run of segments catching the overhead light.
Blades repeat at a regular **pitch** measured **along the direction of travel**.
Pick the blade's width and its pitch once and use the same ones in every form and
tier; a higher tier may add a finer secondary tread mark, but on the same pitch.

**The chevrons.** A **single** row of **chevrons** — the direction markers — is
**painted onto the belt surface** down the **centre line** of the belt, pointing
in the direction of travel, in **that tier's accent color**. A chevron is a small
arrowhead: its **tip leads** downstream and its two arms open back **upstream**,
drawn in the tier's mover tone with the highlight tone along its leading/outer
edge and the shadow tone along its trailing/inner edge so it reads with a little
depth. Chevrons repeat at their own regular **pitch** along the direction of
travel. Pick the chevron's size and pitch once and use the same ones in every form
and tier.

Pick the **blade pitch so that the chevron pitch is a whole multiple of it**
(blades every 8 px and chevrons every 16 px, say) — usually a blade or two between
chevrons. Because the two share that factor they advance as one locked pattern and
come back into register together at the wrap, which is what keeps each loop
seamless. Pick a chevron pitch that divides the 32 px tile **evenly** so the
straight belt tiles edge-to-edge — **16 px is a good choice** (32 px also works).
**Do not aim for a particular number of chevrons:** how many fit follows from the
pitch you pick, and the count is not what is judged.

**One belt, not two lanes.** In every form the surface between the rails is **one
uninterrupted conveyor**, wide enough that **two items ride side by side and
together span its full width**. The chevrons are **painted onto** that surface as
movement markers: they do **not** carve the belt into lanes, do **not** reserve a
strip of their own, and the surface under and around them is the **same** surface
items rest on. There is **no hard divider** down the middle or along the curve and
there are **no inner lane rails**.

## The straight belt

A top-down straight segment that **fills the whole 32×32 tile** edge to edge —
there is no transparent margin. Its two rails run along the **top and bottom**
edges, alongside the direction of travel, with the surface between them. The tread
blades are short **vertical** bars — perpendicular to the East–West travel — and
the chevrons run down the tile's **horizontal centre line**, pointing **East**.

The segment must **tile horizontally**: the left and right tile edges line up, so
copies placed edge-to-edge look continuous with no seam in the body, the rails, or
the surface pattern — including any tier's added rail or tread detail.

## The curve

The same belt, bent through a quarter turn. The turn is centred on the tile's
**South-West corner**, which is the **inside** of the bend, so the belt sweeps
from the **West edge** round to the **South edge** and only the far **North-East
corner** of the tile — the region beyond the outer edge of the belt — is left
transparent.

- **The outer rail** follows the **convex** arc, sweeping from the top of the West
  mouth round the outside to the East end of the South mouth. It is the curved
  counterpart of a straight belt's outer side rail, with the same thickness and
  the same dark outline inside it.
- **The inner rail** follows the **concave** side of the bend. Because the turn is
  centred on the tile corner, the inside of the bend is very tight: the inner rail
  is a small **quarter-round nub wrapping the pivot** at the corner. It is not
  decoration — it is the straight belt's inner rail **continuing around the
  corner**, and it must have the same thickness and the same dark outline as every
  other rail. Without it, a straight belt's inner rail would run into the corner
  tile and simply stop.
- **The surface** is the band between the two rails: a quarter-round of conveyor,
  the same width as the straight belt's surface, sweeping from the West mouth to
  the South mouth.
- **The tread blades** stay perpendicular to travel, which on a curve means each
  blade points **at the inside corner** — a spoke across the belt, spanning the
  surface from the inner rail out to the outer one. Because they are spokes they
  **fan apart toward the outer rail and crowd together toward the inside** of the
  bend. That means a blade of fixed width would swallow the gap entirely near the
  pivot and turn the inside of the turn into a solid field of metal, which is
  wrong: the tread must stay **countable across the whole width of the belt**. So
  a curved blade is a **wedge**, as a real curved conveyor's slats are — the
  straight belt's full width out at the rim and through the belt's centre line,
  then narrowing in proportion to the radius the rest of the way in. Width and gap
  then shrink together, so a blade takes up **the same share of every gap at every
  radius that it does on the straight belt**, and the tread reads at the same
  density right across the turn. Carry the blade's dark leading edge only where
  there is room for it — once the wedge narrows past a pixel or so, a blade is
  better read as a plain raised tick on the base tone than as an edge that swamps
  it.
- **The chevrons** ride the centre line of the curve, each pointing **along the
  direction of travel at its own point on the arc** — leading East where flow
  enters at the West edge and rotating round to lead South where it leaves at the
  South edge, arms trailing back upstream. They follow the bend rather than
  pointing one fixed direction, and each is the **same arrowhead** as the straight
  belt's, only turned to the arc, in the tier's accent color.

The belt is one continuous curved surface sweeping from the West face round to the
South face — **not** a straight segment, **not** two straight stubs meeting at a
hard right angle, and **not** a turn of the wrong angle or handedness.

## Where the two forms meet

Within each tier, the straight belt and its curve join, and that join is judged as
hard as either form on its own.

**Flush edges.** The curve's **West entry** edge and its **South exit** edge each
present the belt's full 32 px face, and each must present the **same
cross-section** as the same tier's straight belt exit edge — rail for rail, outline
for outline, surface for surface, at exactly the same distances across the belt.
Put a straight tile immediately West of a curve tile of the same tier and the
rails, the outlines, and the surface band must run straight through the boundary
with **no step, no gap, and no overhang**: the two rails of the straight belt
continue as the curve's outer and inner rails, and the surface continues as the
curve's surface. The same must hold at the South exit against a straight belt
rotated to run South. A curved _band_ pulled back from the corner — which would
narrow the mouths below the full belt width — is wrong, and so is a mouth that
drops the inner rail and runs bare surface into the corner.

**Continuous motion across the junction.** Within a tier the two forms must
animate as **one moving surface**, not as two sprites that each happen to loop.
That means:

- Both forms measure their pitches and their scroll in the **same units — pixels
  of travel along the belt**. On the curve, distance along the belt is measured
  along the belt's **centre line**, so one pixel of travel on the curve is one
  pixel of travel on the straight belt. (Measured this way a quarter turn is a
  little over 24 px of belt, so a curve tile carries proportionally less pattern
  than a 32 px straight tile — that is expected.)
- Both forms use the **same blade pitch**, the **same chevron pitch**, and the
  **same per-frame step**, so a straight tile and a curve tile shown at the same
  frame index are at the **same point in the cycle**.
- The phase must **line up at the mouth**: the pattern arriving at the straight
  belt's exit edge must be exactly the pattern leaving the curve's entry edge on
  that same frame, so a blade or chevron crossing the junction is never cut,
  doubled, or jumped. Because the straight tile is a whole number of chevron
  pitches wide, its pattern at the East edge is the same as its pattern at the West
  edge — so aligning the curve's entry with the start of a pitch is what puts the
  two in phase.

Played side by side at the same frame rate, a straight tile feeding a curve of the
same tier should read as one continuous belt whose surface flows through the
corner.

## How the surface scrolls across each eight-frame loop

Within each form and tier the eight frames are the same belt with the **whole
surface pattern — the tread blades and the chevrons together** — advanced
downstream. The chevron pitch is the repeat the offsets are measured in, and the
central requirement is that the surface **actually advances**: over the loop the
pattern travels a full chevron pitch forward, it does **not** flip back and forth
between two positions.

- Shift the **whole surface pattern (blades and chevrons, locked together)**
  downstream by exactly **one-eighth of the chevron pitch** each frame — on the
  straight belt that is to the right; on the curve it is forward **along the arc**,
  following the bend, not straight down or straight across. So across the eight
  frames the pattern steps forward by ⅛, ¼, ⅜ … ⅞ of a pitch, and after the wrap it
  has advanced **exactly one full chevron pitch**. With a 16 px pitch that is a
  clean **2 px per frame**.
- Because the per-frame step is the pitch divided by the frame count, **every one
  of the eight frames sits at a distinct offset** — no two frames are alike, so the
  eye sees the blades and chevrons creeping steadily forward rather than two frames
  alternating in place. (A step of _half_ the pitch, for example, would collapse a
  loop into just two repeating images that oscillate — avoid that.)
- **The last frame of each loop must return seamlessly to its first**: after the
  eighth frame's offset the next step lands exactly one full pitch on, which is
  identical to the first frame's pattern, so playing the loop reads as one belt
  moving steadily with no jump, stutter, or backward slip. Because the chevron
  pitch is a whole number of blade pitches, the blades come back into register at
  the same wrap.
- On the **straight** belt, a blade or chevron that scrolls off the right edge
  **re-enters from the left** by the same amount, so every frame is a full belt
  with no gap. On the **curve**, pattern that leaves the South mouth is matched by
  pattern entering at the West mouth, so every frame is likewise a full belt.

Every tier's loop is built this same way. The three tiers differ only in accent,
detail, and the rate the loop is played back at — so the higher tiers read as
faster belts without being drawn any differently frame to frame.

Only the **rails and the tile's outline** hold still frame to frame — they are the
fixed belt structure. **Everything on the surface — the tread blades and the
chevrons — scrolls together.** A frozen surface with only the arrows moving is the
failure to avoid: the blades are the main "it is running" cue, and the chevrons say
which way.

## Palette

Use only these colors. The metal body is shared by every tier; each tier draws its
movers (tread catch-lights and chevrons) in its own accent trio.

### Shared metal body — every tier

| Role                  | Hex       |
| --------------------- | --------- |
| Dark outline / shadow | `#1b1d21` |
| Belt metal base       | `#34383d` |
| Belt metal mid        | `#4a4f55` |
| Rail / edge highlight | `#6b7178` |

### Tier 1 mover — amber

| Role            | Hex       |
| --------------- | --------- |
| Mover / chevron | `#e6b329` |
| Mover highlight | `#f6d96b` |
| Mover shadow    | `#b88410` |

### Tier 2 mover — red-orange

| Role            | Hex       |
| --------------- | --------- |
| Mover / chevron | `#e6602a` |
| Mover highlight | `#f59a5a` |
| Mover shadow    | `#b8400f` |

### Tier 3 mover — blue-cyan

| Role            | Hex       |
| --------------- | --------- |
| Mover / chevron | `#2ab0e6` |
| Mover highlight | `#7fd8f6` |
| Mover shadow    | `#1069b8` |
| Energy glow     | `#bfeeff` |

The tier-3 **energy glow** is a thin bloom of pale cyan used sparingly along the
chevron row to sell the most advanced belt; it appears in no other tier.

## Working the tool

The `draw-sheet` binary is the only way to make a mark. You draw into the frame you
select with `--frame <index>`, using plain in-frame coordinates (0–31). Run
`draw-sheet --help` for the available operations (filling and stroking circles and
rectangles, lines, single pixels, and flood fill) and `draw-sheet <operation>
--help` for each one's exact flags — that help text is the authoritative contract.
A quarter-round belt is well suited to nested filled circles centred on the tile's
South-West corner, laid down outermost band first so each one leaves a ring of the
one before it; the blades and chevrons are then drawn over the surface. Call
`draw-sheet` once per operation and read `frames/<index>.png` between calls to
judge that frame against this brief.
