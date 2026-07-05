# Wireworm Corruptor — drawing brief

You are drawing the **corruptor**, a **sprite sheet** for a circuit-board arcade
game. The corruptor is a support foe: a low, many-legged crawler that scuttles
**horizontally** across the top of the board, and every capacitor node it touches
it slams to a **full, critical charge** — arming the board's traps. It has to read
as a **leggy crawler** with a glowing **amber charge stinger**, clearly a
different beast from the tall, armored data-worm.

You are drawing the corruptor as a short **crawl animation**: four frames of the
same crawler with its legs cycling, so it scuttles when the game plays it.

## Compositing — a creature on transparency

Every frame is drawn on a fully **transparent** background so it composites onto
the dark circuit board.

- The only opaque pixels are the corruptor itself; do **not** fill the background.
- Keep everything in the **palette** below — no other colors.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background.
  Origin is the top-left; `x` increases to the right, `y` increases downward
  (0–31). The corruptor **faces and moves to the right** (the game mirrors it to
  move left).
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **4 frames, numbered 0–3**, played as one crawl loop.

### The crawler (shared body, cycling legs)

- **Body:** a low, wide segmented body about **(4, 12)** to **(27, 21)** — roughly
  23 px wide, 9 px tall, centered vertically in the frame. Draw it as three or four
  linked oval segments in the toxic-green mid color, outlined/glinted in the bright
  edge color along the top and shaded dark (carapace-dark) along the bottom.
- **Head:** the rightmost segment is the head, carrying a small red **sensor eye**
  near the leading (right) edge.
- **Charge stinger:** a short tail element rising from the rear-left of the body
  (around **(4, 8)**) tipped with an **amber glow** — the charge it pours into
  nodes. The amber tip is the same amber the board's nodes glow when critical.
- **Legs:** a row of short legs (little dark ticks) dropping from the underside
  of
  the body (around **y = 21–26**), several per side.

## What goes in each frame

The body, head, and stinger are the **same** in every frame; only the **legs** and
a small body **bob** change so it scuttles:

| Frame | Legs |
| --- | --- |
| 0 | Legs in stance A — forward pair reaching ahead, rear pair back. |
| 1 | Mid-stride — legs gathered under the body; body bobbed **up** ~1 px. |
| 2 | Stance B — the opposite reach from frame 0 (legs that were forward now back). |
| 3 | Mid-stride again — legs gathered; body bobbed up ~1 px (the other half of the gait). |

Make it read as a **horizontal scuttle**:

- The body, head eye, and amber stinger are consistent across all four frames —
  only the legs step and the body bobs ~1 px.
- The leg cycle should read as alternating stride (0 and 2 are the two extremes,
  1 and 3 the passes between), not random twitching.
- Keep the crawler **centered** and the **same size** each frame; it walks in
  place (the game moves it).
- It must not look like the data-worm: it is **low and wide with legs and an amber
  stinger**, not a tall, legless, magenta-seamed armored segment.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Carapace — mid (body fill) | `#4e7a1e` |
| Carapace — dark (bottom shade, legs) | `#17280e` |
| Carapace — edge (top glint, outline) | `#8fd63a` |
| Charge stinger glow (amber) | `#ffb43a` |
| Sensor eye (head) | `#ff5a3c` |

## Working the tool

Build the body in frame 0 first — the linked green segments, the edge glint and
dark underside, the head eye, and the amber-tipped stinger — then copy that body
into frames 1–3 and only change the legs (stepping through the gait) and the
~1 px
bob. Use the circle and rectangle operations for the body segments and stinger,
short lines or single pixels for the legs and eye, and the fill operations as
needed. Run `draw-sheet --help` for the available operations and `draw-sheet
<operation> --help` for each one's exact flags. Call `draw-sheet` once per
operation and read `frames/<index>.png` between calls. Play the four frames as a
loop and make sure the legs read as a steady scuttle and the amber stinger stays
lit throughout.
