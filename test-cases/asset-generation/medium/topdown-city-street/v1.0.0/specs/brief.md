# Top-Down City Street Tileset — drawing brief

You are drawing a **top-down city-street tileset**: a **single 96×96 sprite** that
packs **nine 32×32 tiles** into a **3×3 grid**. A top-down (overhead) city game slices
this image into its nine cells and repeats them to build street maps — roads,
sidewalks, crossings, and lots. The whole set must read as **one cohesive city**: the
same overhead viewpoint, the same palette, the same flat lighting across every tile.

The two things that make it a *tileset* rather than nine loose pictures:

- **Strictly top-down.** Every tile is seen from straight overhead — flat markings
  painted on flat ground. No perspective, no height, no side faces, no isometric skew,
  no cast shadows implying a light direction. The AC unit, the curb, and the manhole
  are shapes seen from directly above.
- **Edge-to-edge tileable.** Tiles butt together and repeat. A road tile placed next to
  a copy of itself must have no visible seam, and its center line must continue across
  the shared edge. Keep the repeating surfaces (asphalt, sidewalk, grass) flat and
  even, and put directional markings where they line up when the tile repeats.

## The canvas and grid

- A single **96×96-pixel** image. Origin is top-left; `x` increases to the right, `y`
  increases downward (0–95).
- It is a **3×3 grid of 32×32 cells**. The nine tiles **completely fill** the frame —
  paint all 96×96, leaving **no transparent gaps** and no margin between cells. (The
  canvas simply starts transparent.)
- Cell boundaries fall on multiples of 32: columns at x `0–31`, `32–63`, `64–95`; rows
  at y `0–31`, `32–63`, `64–95`.

## The nine tiles

Place these tiles in exactly these cells (row by row, left to right):

| Cell | x range | y range | Tile |
| --- | --- | --- | --- |
| Top-left | 0–31 | 0–31 | **Plain asphalt road** |
| Top-center | 32–63 | 0–31 | **Road with dashed center line** |
| Top-right | 64–95 | 0–31 | **Zebra crosswalk** |
| Mid-left | 0–31 | 32–63 | **Concrete sidewalk** |
| Mid-center | 32–63 | 32–63 | **Grass verge** |
| Mid-right | 64–95 | 32–63 | **Rooftop with AC unit** |
| Bottom-left | 0–31 | 64–95 | **Parking-lot patch with stall line** |
| Bottom-center | 32–63 | 64–95 | **Manhole-cover road tile** |
| Bottom-right | 64–95 | 64–95 | **Curb / sidewalk-to-road transition** |

**1. Plain asphalt road.** Fill the cell with the asphalt grey. Scatter a light,
subtle speckle of the darker asphalt tone for aggregate texture. Uniform enough that
copies of it tile with no visible seam — no strong feature anchored to the middle.

**2. Road with dashed center line.** Asphalt like tile 1, plus a **vertical dashed
lane line** in lane yellow running down the center of the cell (around x 15–16 within
the cell). Draw it as short dashes with gaps so that when the tile is stacked
vertically the dashes continue as one broken line — a dash should reach the top and
bottom edges consistently, not leave a long blank gap at the seam.

**3. Zebra crosswalk.** Asphalt base with **thick white stripes** running one
direction across the cell — several evenly spaced lane-white bars with asphalt gaps
between them. Space the stripes so the pattern continues across the shared edge when the
tile repeats along the road (a stripe near each cell edge, even gaps).

**4. Concrete sidewalk.** Fill with the sidewalk light grey. Add a couple of faint
**expansion-joint lines** in curb grey (a straight groove or two) to read as poured
concrete panels. Keep it flat and even so it tiles seamlessly.

**5. Grass verge.** Fill with the grass green. Dapple it with small specks and short
strokes of the dark grass tone for texture — an even, tileable patch of grass with no
single dominant clump.

**6. Rooftop with AC unit.** Fill the cell with the rooftop tan (a flat gravel/tar
roof seen from above). Centered on it, draw a **small square AC unit**: a curb-grey box
with a darker (shadow) top vent — a few short shadow lines suggesting the vent grille —
sitting flat on the roof. Seen from straight above, so the unit is a small square, not a
box in perspective.

**7. Parking-lot patch with stall line.** A darker parking-lot asphalt patch (use the
asphalt grey, a touch of the speckle) with a **single painted stall divider line** in
lane white — a straight white stripe near one side of the cell (e.g. a vertical line a
few pixels in from an edge), marking the boundary between two parking stalls.

**8. Manhole-cover road tile.** Asphalt like tile 1, with a **round manhole cover**
centered in the cell: a filled circle of the darker asphalt tone, ringed with curb grey,
with a couple of short shadow lines across it for the cover's texture/seam. It reads as
a metal disc set flush into the road, seen from directly above.

**9. Curb / sidewalk-to-road transition.** The cell is split: **sidewalk** (light grey)
on one half and **asphalt road** on the other, divided by a straight **curb** — a band
of curb grey with a thin shadow line along the road side where the curb steps down to
the street. Keep the split on a clean straight line (e.g. sidewalk on the left/top,
road on the right/bottom) so a game can butt sidewalk tiles against road tiles along it.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Asphalt (road surface) | `#4a4d52` |
| Asphalt speckle (darker aggregate) | `#3d4045` |
| Sidewalk / concrete (light grey) | `#b9b7ae` |
| Curb (mid grey) | `#8b8a82` |
| Lane yellow | `#e6c23c` |
| Lane white | `#e9e7dd` |
| Grass (green) | `#5b8a39` |
| Grass shadow (dark green) | `#3f6127` |
| Rooftop (tan) | `#c3a877` |
| Shadow / seam | `#2b2d31` |

Every tile is painted from this set — the AC unit is curb grey with a shadow vent, the
manhole is the darker asphalt tone ringed in curb grey, and so on. No other colors.

## Working the tool

Block in each cell's base surface first with a full-cell rectangle in its ground color,
then add the markings and features on top. Keep the repeating surfaces flat and even,
and place the road line, crosswalk stripes, and curb so they meet the cell edges where
they need to line up when the tile repeats. Use rectangle fills for the cell bases and
the AC unit, short lines and single pixels for the lane markings, stripes, joints,
speckle, and the manhole ring. Run `draw --help` for the available operations and
`draw <operation> --help` for each one's exact flags. Call `draw` once per operation and
read `canvas.png` between calls to judge it against this brief — the finished image
should read at a glance as one cohesive, strictly top-down city-street tileset whose
nine tiles align on a clean 3×3 grid and repeat seamlessly.
