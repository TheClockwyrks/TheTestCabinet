# Slime Enemy Bounce — drawing brief

You are drawing a **green slime enemy**, a **sprite sheet** of one bouncing hop.
It is a cute, soft, **jelly-like green blob** with two simple eyes — the kind of
harmless little creature that bounces along the ground toward whatever it is
chasing. You are drawing a single **squash-and-stretch hop loop**: the slime
gathers low, springs up, floats over the top, drops, and lands, then does it all
again. The six frames play in order and loop, so the last frame has to lead back
into the first.

## Compositing — a creature on transparency

Every frame is drawn on a fully **transparent** background so the slime composites
onto any scene.

- The only opaque pixels are the slime itself; do **not** fill the background.
- Keep everything in the **palette** below — no other colors.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background.
  Origin is the top-left; `x` increases to the right, `y` increases downward
  (0–31). Coordinates are **within the frame** — there is no shared sheet to
  offset into.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **6 frames, numbered 0–5**.
- The slime is small enough to leave room to move: it sits within the frame with
  a margin, so it can squash wider and stretch taller without clipping the edges.
  Keep it horizontally centered, and treat the bottom of the frame as the ground
  it bounces on.

## What goes in each frame

The **same slime** through one hop, its shape changing frame to frame. The classic
squash-and-stretch arc — flatten on the ground, elongate through the air, round off
at the top:

| Frame | Phase | Shape |
| --- | --- | --- |
| 0 | **rest** — squashed on the ground | wide and flat, sitting low, gathered for the jump |
| 1 | **launch** — springing up | stretched **tall**, narrowed, pushing off the ground |
| 2 | **rising** | rounding out, still moving up, off the ground |
| 3 | **apex** | a rounded blob at the top of the arc, momentarily still |
| 4 | **falling** — dropping back | stretched **tall** again as it plunges toward the ground |
| 5 | **landing** — impact | squashed **wide** and flat as it hits, about to settle |

Make it read as **one cute slime**:

- A **rounded, jelly-like body** — soft and organic, a gooey blob, never a hard
  geometric shape. Give it a **soft highlight** near the top so it looks wet and
  gel-like, and let the read feel a little **translucent**, like light passes
  through it.
- Shade the **underside** with the deep-green shadow so the blob has form and sits
  on the ground rather than floating flat.
- **Two simple eyes** sit on the body and stay readable in every frame — a dark
  eye with a small bright shine, both looking toward the viewer. They ride the
  body: as it squashes they sit lower and wider apart, as it stretches they rise
  and gather; they must never detach, vanish, or slide off the blob.
- **Conserve the volume.** When it squashes it gets **wider and shorter**; when it
  stretches it gets **taller and narrower** — it is the same amount of jelly, just
  reshaped. That is what sells the bounce.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Slime body (green) | `#57c04a` |
| Highlight (pale sheen) | `#b6ec8f` |
| Shadow (deep-green underside) | `#2f7d34` |
| Eyes (dark) | `#14210f` |
| Eye shine | `#ffffff` |

The body is the green `#57c04a`, lit by the pale `#b6ec8f` sheen near the top and
grounded by the `#2f7d34` shadow underneath; the two `#14210f` eyes each carry a
tiny `#ffffff` shine. Do not use any other color, and keep the background fully
transparent.

## Working the tool

Build the resting slime first — a wide, rounded green blob low in the frame, a pale
sheen near the top, a shaded underside, and two dark eyes with a shine — then reuse
that blob for the other frames: raise it and stretch it tall for the launch, round
it out for the rise and apex, stretch it again for the drop, and squash it wide for
the landing, moving and reshaping the eyes with the body each time. Use the filled-
circle and rectangle operations for the round body, single pixels for the eyes and
shine, and flood fill for the shadow and highlight regions; the horizontal mirror
keeps the blob left-right symmetric. Run `draw-sheet --help` for the available
operations and `draw-sheet <operation> --help` for each one's exact flags. Call
`draw-sheet` once per operation and read `frames/<index>.png` between calls. Play
the six frames as a hop in your head — squash, spring, float, drop, squash — and
keep it the same cute green slime throughout.
