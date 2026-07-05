# Wireworm Cursor — drawing brief

You are drawing the **defrag cursor**, a **single sprite** for a circuit-board
arcade game. It is the **player**: a small craft that patrols a shallow band at
the bottom of the board and fires **upward** at the data-worm descending toward
it. It has to read instantly as *the player's own ship* — clean, friendly, and
clearly pointing up — never as one of the hostile bugs on the board.

## The canvas

- A single **32×32-pixel** image with a transparent background. Origin is the
  top-left; `x` increases to the right, `y` increases downward (0–31). The center
  is near **(16, 16)**.
- The cursor **points up** (it fires toward the top of the screen). Draw it
  upright, centered, filling most of the frame with a ~3 px margin.
- Draw on full **transparency** — the only opaque pixels are the cursor itself;
  do **not** fill the background.

## The form

A compact upward craft that reads as a **cursor / targeting caret** crossed
with a
small ship:

- **Hull:** an upward-pointing arrowhead (a delta): a wide base bar low in the
  frame (about **y = 22–26**, spanning **x = 7–25**) narrowing to a **muzzle tip**
  at the top near **(16, 5)**. Outline it in the bright trim color and fill it with
  the light chassis color, shaded darker (chassis-dark) toward the base.
- **Reactor core:** a small bright core disc in the middle of the hull (near
  **(16, 16)**) in the core-glow color, with a single highlight pixel — the ship's
  power read.
- **Muzzle:** a short bright notch in the highlight color at the very tip
  (near **(16, 5)**), where its shots emerge upward.
- **Caret ticks:** two short diagonal ticks in the trim color at the lower-left
  and lower-right corners of the base (like the corner marks of a selection
  cursor), so it reads as a defrag *cursor*, not just a jet.
- **Thruster glow:** a faint core-glow underglow along the bottom edge beneath the
  base bar.

Keep it **symmetric** about the vertical center line (`x = 16`) and unmistakably
**friendly** — cool cyan and white, distinct from the hostile bugs.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Chassis — light (hull fill) | `#3f8ba3` |
| Chassis — dark (base shade) | `#163743` |
| Reactor core / thruster glow | `#57e0ff` |
| Highlight / muzzle | `#eafcff` |
| Trim (outline, caret ticks) | `#9ff0ff` |

## Working the tool

Block in the delta hull first — the base bar and the taper up to the muzzle
tip —
then outline it in trim, shade the base with chassis-dark, and add the reactor
core, muzzle notch, caret ticks, and the thruster underglow. Use the rectangle,
line, and circle operations for the hull and core, single pixels for the muzzle,
ticks, and highlight, and the horizontal mirror to keep the two sides symmetric.
Run `draw --help` for the available operations and `draw <operation> --help` for
each one's exact flags. Call `draw` once per operation and read `canvas.png`
between calls to judge it against this brief — it should read at a glance as an
upward-pointing player craft, cool and friendly, centered on transparency.
