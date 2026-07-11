# Wireworm Glitch — drawing brief

You are drawing the **glitch**, a **sprite sheet** for a circuit-board arcade
game. The glitch is a support foe: a corrupted, unstable sprite that skitters
around the player's band, eating the capacitor nodes off the board. It has to read
as **corruption made visible** — an angular mass that flickers and tears,
split by
chromatic-aberration fringes and scattered static — so a glance says *hostile
error*, not a solid creature.

You are drawing the glitch as a short **flicker animation**: four frames of the
same corrupt mass jittering, so it never sits still.

## Compositing — corruption on transparency

Every frame is drawn on a fully **transparent** background so it composites onto
the dark circuit board.

- The only opaque pixels are the glitch itself; do **not** fill the background.
- Keep everything in the **palette** below — no other colors.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background.
  Origin is the top-left; `x` increases to the right, `y` increases downward
  (0–31). The mass is roughly centered near **(16, 16)**.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **4 frames, numbered 0–3**, played as one flickering loop.

### The corrupt mass (varied across the four frames)

Each frame is the same idea rendered slightly differently so it flickers:

- A jagged, **angular blob** — a chunky mass of hard-edged rectangles about
  **16×16 px** centered near (16, 16), filled in the error-red core color. No
  smooth curves; it looks like a shattered, half-drawn sprite.
- **Chromatic-aberration fringes:** a 1–2 px copy of the mass's left edge offset
  and drawn in the cyan color, and a matching 1–2 px copy of the right edge in the
  magenta color — the red/cyan/magenta split of a broken signal.
- **Scanline tears:** one or two full-width horizontal breaks across the mass
  (a row shifted sideways by a few px, or a gap), so the sprite looks torn.
- **Static:** a scatter of a few loose white pixels around the mass — sparks of
  noise.

Make it read as an **unstable flicker**, not a walk cycle:

- Across frames 0→3, **jitter** the mass a couple of px, move the scanline tears
  to different rows, shift the chromatic fringes, and re-scatter the white static
  — every frame is a different corruption of the same blob.
- Keep the mass **centered and about the same size** each frame (it jitters in
  place; it does not travel or grow).
- Do not give it a face, legs, or a consistent silhouette — its instability is the
  point.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Glitch core (error red) | `#d92b4a` |
| Chromatic fringe — cyan | `#2be0d9` |
| Chromatic fringe — magenta | `#ff4fd8` |
| Deep shadow | `#1a0f1c` |
| Static (hot noise) | `#ffffff` |

## Working the tool

Build the core mass in frame 0 first — a cluster of hard rectangles in error-red
with a little deep-shadow on one side — then add the cyan/magenta edge
fringes, a
scanline tear, and a few white static pixels. For frames 1–3, redraw the same mass
shifted a couple of px with the tears and fringes in new places and the static
re-scattered. Use the rectangle operations for the blocky mass and fringes, single
pixels or short lines for the static and tears, and the fill operations as needed.
Run `draw-sheet --help` for the available operations and `draw-sheet <operation>
--help` for each one's exact flags. Call `draw-sheet` once per operation and read
`frames/<index>.png` between calls. Play the four frames as a fast loop and make
sure it reads as a jittering, tearing glitch that never holds still.
