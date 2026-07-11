# Wireworm Dropper — drawing brief

You are drawing the **packet dropper**, a **single sprite** for a circuit-board
arcade game. It is a support hazard: a data packet that falls **straight down**
the board, seeding fresh capacitor nodes in its wake when the field gets too thin.
It has to read as a **falling packet in motion** — a compact data parcel dropping
downward, warm amber so it reads as a hazard against the cool board — not a
creature and not the player.

## The canvas

- A single **32×32-pixel** image with a transparent background. Origin is the
  top-left; `x` increases to the right, `y` increases downward (0–31). The center
  is near **(16, 16)**.
- The packet is **falling down**: draw its motion reading top-to-bottom, the
  parcel low-centered with its motion trail rising above it.
- Draw on full **transparency** — the only opaque pixels are the packet and its
  trail; do **not** fill the background.

## The form

A small **data packet** plummeting:

- **Parcel:** a compact rounded square about **(9, 12)** to **(23, 26)** — roughly
  14×14 px, centered horizontally on **x = 16** and sitting in the lower half of
  the frame. Outline it in the bright edge color and fill it with the amber body
  color, shaded darker (packet-dark) along the top (the trailing side).
- **Glyph:** a small **down-chevron** (a ▼) in the dark glyph color on the face
  of
  the parcel, pointing down — it is a packet heading downward.
- **Motion trail:** two or three short vertical streaks in the pale trail color
  rising from the top of the parcel toward the top of the frame (around **y =
  2–11**), fading upward — the speed lines of a falling object.
- **Leading glow:** a faint trail-color glow along the bottom edge of the parcel,
  the leading face as it drops.

Keep it **symmetric** about the vertical center line (`x = 16`) and unmistakably
**in downward motion** — a parcel with trailing speed lines above it, not a static
box.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Packet body (amber) | `#e8a83a` |
| Packet — dark (top/trailing shade) | `#6b4410` |
| Packet edge (outline) | `#ffd98a` |
| Glyph (down-chevron) | `#2a1a05` |
| Motion trail / leading glow | `#fff0c2` |

## Working the tool

Block in the parcel first — the rounded square, its edge outline, and the
packet-dark shade along the top — then add the down-chevron glyph, the rising
motion-trail streaks, and the leading glow along the bottom. Use the rectangle and
circle operations for the parcel, lines for the trail streaks and the chevron, and
single pixels for the glow, plus the horizontal mirror to keep the two sides
symmetric. Run `draw --help` for the available operations and `draw <operation>
--help` for each one's exact flags. Call `draw` once per operation and read
`canvas.png` between calls to judge it against this brief — it should read at a
glance as a warm data packet dropping straight down, centered on transparency.
