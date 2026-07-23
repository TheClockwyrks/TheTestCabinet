# Spinning Coin Pickup — drawing brief

You are drawing a **spinning gold coin**, a **sprite sheet** of a valuable
collectible pickup. It is a shiny gold coin — the kind a player grabs for points —
turning about its **vertical (up–down) axis** so that you see its round face, then
its edge, then its face again. Across the six frames it makes one continuous turn
that reads as a **seamless loop**, with a bright **glint** sweeping across the face
as it catches the light.

## Compositing — a coin on transparency

Every frame is drawn on a fully **transparent** background so the coin composites
onto any scene.

- The only opaque pixels are the coin itself; do **not** fill the background.
- Keep everything in the **palette** below — no other colors.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background.
  Origin is the top-left; `x` increases to the right, `y` increases downward
  (0–31). The coin is centered, filling most of the frame with a small margin, and
  stays the **same height** in every frame — only its **width** changes as it
  turns.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **6 frames, numbered 0–5**.

## What goes in each frame

The same coin turning about its vertical axis. Think of the width of an ellipse: a
face-on coin is a full circle (widest), an edge-on coin is a thin vertical sliver
(narrowest). The height never changes; the width shrinks to the edge and grows
back:

| Frame | Pose | Face | Width |
| --- | --- | --- | --- |
| 0 | full face | round face fully visible | widest — a full circle |
| 1 | three-quarter | face compressed | narrower ellipse |
| 2 | near edge | a sliver of face | narrow ellipse |
| 3 | **edge-on** | no face — just the edge | thinnest — a vertical sliver |
| 4 | near edge | face reappearing (other side) | narrow ellipse |
| 5 | three-quarter | face widening back | wider ellipse |

Playing 0 → 5 and looping back to 0 makes the coin spin forever: it narrows to the
edge at frame 3, then widens back, and frame 5 flows straight into frame 0. Keep
the ellipse widths **symmetric about frame 3** (frame 2 and frame 4 the same
width, frame 1 and frame 5 the same width) so the loop is clean and the motion
reads as a smooth, even rotation.

Make it read as **one valuable gold coin**:

- A **gold disc** with a slightly **darker gold rim** running around the edge, so
  it reads as a struck coin with a raised border, not a flat circle. A hint of an
  inner face — a small emboss, ring, or symbol in the darker gold — sells it as
  minted.
- On the **edge-on** frame (3), drop the face entirely: draw just a thin vertical
  bar, gold with the darker gold along its length, so it reads as the coin seen
  from the side.
- Shade the coin so the top catches light and the lower edge is the darker gold —
  a little roundness, not a flat token.

## The glint

A single bright **white star/glint** highlight sits on the face and **sweeps
across it** as the coin turns:

- It is a small four-point sparkle or bright spot — a few white pixels — on the
  gold face.
- It moves across the face over the face-on and near-face frames (0, 1, 2 and 4,
  5), tracking the light, and **disappears on the edge-on frame (3)** where there
  is no face to catch.
- Keep it to the white glint color only; it should read as a shiny highlight, not
  a hole in the coin.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Gold — face (lit) | `#f2c531` |
| Gold — rim / shadow (dark) | `#b07d16` |
| Rim outline / minting (darkest) | `#5c3d08` |
| Glint (highlight) | `#ffffff` |

## Working the tool

Build the full-face coin first — a gold disc, a darker gold rim around it, a hint
of an inner face, a touch of shading, and the white glint — then reuse that coin
for the narrower frames: squash it horizontally to the ellipse width each frame
calls for, keeping the same height and center, until it is a thin vertical sliver
edge-on at frame 3, then widen it symmetrically back. Move the glint across the
face frame by frame and drop it on the edge-on frame. Use the filled-ellipse and
rectangle operations for the disc and rim, and single pixels for the glint and the
inner-face detail. Run `draw-sheet --help` for the available operations and
`draw-sheet <operation> --help` for each one's exact flags. Call `draw-sheet` once
per operation and read `frames/<index>.png` between calls. Play the six frames as a
loop in your head — face, edge, face — and keep it the same gold coin, the same
height and center, in every frame.
