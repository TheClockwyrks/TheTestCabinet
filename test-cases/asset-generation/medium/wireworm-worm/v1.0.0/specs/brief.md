# Wireworm — drawing brief

You are drawing the **data-worm**, a **sprite sheet** for a circuit-board arcade
game. The worm is the enemy: a segmented intruder that winds down the board,
reversing and dropping a row whenever it bumps the terrain. The game builds a
worm of any length by **tiling** these parts in a row — a head, a run of body
segments, and a tail — so each part is drawn on its **own cell-sized frame** and
must line up edge-to-edge with its neighbors.

You are drawing the worm as its tileable parts, each with a two-pose **wiggle**
so
it crawls when the game plays the segments.

## Compositing — a creature on transparency

Every part is drawn on a fully **transparent** background so it composites onto
the dark circuit board.

- The only opaque pixels are the worm itself; do **not** fill the background.
- Keep everything in the **palette** below — no other colors.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background.
  Origin is the top-left; `x` increases to the right, `y` increases downward
  (0–31). The worm **faces and moves to the right**: the head leads on the right
  edge, the tail trails on the left (the game mirrors it to move left).
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **6 frames, numbered 0–5**.

### Segment geometry (shared by every part)

Every part is one armored **segment plate** that fills the cell so parts tile
seamlessly:

- A rounded plate roughly **(4, 5)** to **(28, 27)** — about 24 px wide, 22 px
  tall, centered in the cell. Outline it in the bright carapace edge color and
  fill it with the mid carapace color, shaded darker (carapace-dark) along the
  bottom.
- A glowing **data seam** runs across the belly of the plate (a horizontal band
  near **y = 20–23**) in the magenta seam color — the worm's underglow.
- **Link nubs**: a small bump centered on the **left** edge (near `x = 4`) and a
  matching socket/bump on the **right** edge (near `x = 28`) at mid-height, so a
  segment's right edge meets the next segment's left edge and the row reads as one
  continuous body.

## What goes in each frame

| Frame | Part & pose | Contents |
| --- | --- | --- |
| 0 | **head — closed** | The segment plate plus a head: a red sensor **eye** high on the plate and two pale **mandibles** meeting closed at the leading (right) edge. |
| 1 | **head — chomp** | Same head with the mandibles **open** (spread apart at the right edge) — the bite pose. |
| 2 | **body — pose A** | A plain body segment, seam and plate at their neutral position. |
| 3 | **body — pose B** | The same body segment with the plate and seam nudged ~2 px (the crawl wiggle) so 2↔3 reads as undulation, not a jitter. |
| 4 | **tail — pose A** | An end segment tapering to a rounded point at the trailing (left) edge; no left link nub. |
| 5 | **tail — pose B** | The tail wiggled ~2 px like the body, so 4↔5 reads as the tail swishing. |

Make the parts read as **one creature**:

- The plate, edge color, and seam are consistent across all six frames — a head
  and a tail are clearly the **same worm's** segments, just with a face or a
  taper added.
- Only the head frames (0, 1) carry the eye and mandibles; only the head frames
  use the pale mandible color. The body and tail carry no face.
- The wiggle is a small (~2 px) shift of the plate/seam between the paired poses,
  not a redraw — keep the silhouette and size steady so the crawl is smooth.
- Keep every part **centered** in its cell and the **same size**, with the link
  nubs at the same height, so an arbitrary head-body-body-…-tail row tiles cleanly.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Carapace — mid (plate fill) | `#7a2fae` |
| Carapace — dark (bottom shade) | `#2a1533` |
| Carapace — edge (outline, top glint) | `#c06bff` |
| Data seam (magenta underglow) | `#ff3fa4` |
| Sensor eye (head only) | `#ff5a3c` |
| Mandible (pale, head only) | `#f2d9ff` |

## Working the tool

Build one segment plate first — the rounded body (frame 2): outline, mid fill,
dark bottom shade, the magenta seam, and the two link nubs — then reuse that exact
plate for the other parts, adding the head's eye and mandibles (frames 0–1),
tapering the trailing edge for the tail (frames 4–5), and nudging the plate/seam
~2 px for each wiggle pose (frames 3 and 5). Use the rectangle and circle
operations for the plate and seam, single pixels or short lines for the nubs,
mandibles, and eye, and the horizontal mirror where it helps. Run `draw-sheet
--help` for the available operations and `draw-sheet <operation> --help` for each
one's exact flags. Call `draw-sheet` once per operation and read
`frames/<index>.png` between calls. Picture the three wiggle loops — **0↔1** the
head chomping, **2↔3** the body crawling, **4↔5** the tail swishing — and make
each read clearly, then imagine a head-body-body-tail row and confirm the parts
line up.
