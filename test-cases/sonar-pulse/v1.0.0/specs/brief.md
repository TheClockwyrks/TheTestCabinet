# Sonar Pulse — drawing brief

You are drawing the **sonar pulse**, a **sprite sheet** for a deep-sea
maze-chase game. The pulse is the **expanding ring** that travels outward when a
character emits sonar: the player's forager pings to reveal the dark trench, and
the eyeless **Listener** predator emits the same pulse as its tell. It is an
**area effect**, not a creature — a wavefront that spreads across many tiles,
which is why it gets a large canvas of its own.

You are drawing the pulse as a short **animation**: one ring growing outward
from the center and fading, frame by frame.

## Grayscale only — the game tints it

Draw the pulse **purely in grayscale** — white through gray — on a fully
**transparent** background. The game **tints** the effect to the sonar color at
runtime (it multiplies your grayscale by a cold cyan), so your job is only the
*shape and brightness* of the wavefront, never its hue.

- Use **no color at all**: only `#ffffff`, the grays below, and transparency.
- Do **not** fill the background. The only opaque pixels are the ring itself;
  everything else stays transparent so the effect composites over the trench.

## The frames

- Each frame is its own **128×128-pixel** image with a transparent background.
  Origin is the top-left; `x` increases to the right, `y` increases downward.
  Coordinates are **within the frame** (0–127). The center of the frame is near
  **(64, 64)** — expand every ring around that point.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **8 frames, numbered 0–7**, played in order as one pulse.

## What goes in each frame

One **ring expanding outward** from the center, growing and fading across the
eight frames:

| Frames | Contents |
| --- | --- |
| 0 | a small, bright ring close to the center (radius ~10) |
| 1–6 | the ring expands outward a step each frame, getting fainter as it grows |
| 7 | a large, faint ring near the frame edges (radius ~58), about to vanish |

Make it read as a **wavefront**, not a growing solid disc:

- Draw the wavefront as a **stroked ring** (a circle outline a couple of pixels
  thick), not a filled circle — the middle stays open.
- The ring is **brightest when small** (near `#ffffff`) and dims toward the
  faint gray as it widens, so the energy reads as spreading thin.
- Optionally add a **second, fainter trailing ring** just inside the leading one
  (a smaller radius, a darker gray) so the pulse reads as a moving front with a
  wake. Keep it concentric with the leading ring.
- Keep every ring **round and centered** on (64, 64), even in thickness.

## Palette

Use only these grayscale values (the drawing is regenerated pixel-for-pixel, and
the game tints it, so any actual hue or stray pixel counts against you):

| Role | Hex |
| --- | --- |
| Wavefront core (brightest, small ring) | `#ffffff` |
| Wavefront mid | `#b8b8b8` |
| Wavefront / trailing ring (faint, wide ring) | `#5a5a5a` |

## Working the tool

Draw each ring with the circle-outline operation, centered on (64, 64), one ring
per frame (plus an optional fainter trailing ring), increasing the radius and
lowering the brightness frame by frame. Run `draw-sheet --help` for the available
operations (filling and stroking circles and rectangles, lines, single pixels,
flood fill, and a horizontal mirror) and `draw-sheet <operation> --help` for each
one's exact flags. Call `draw-sheet` once per operation and read
`frames/<index>.png` between calls to judge that frame against this brief. A good
order is to lay down frame 0's small bright ring, then step the radius outward
and the brightness down through frames 1–7, checking that played in order they
read as one expanding pulse.
