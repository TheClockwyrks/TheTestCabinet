# RPG Item Icon Set — drawing brief

You are drawing a **set of nine inventory item icons** as a **single sprite** for a
fantasy role-playing game. These are the small, chunky icons that fill an inventory
grid, a shop shelf, or a loot drop: each one has to be **instantly readable at small
size** and the nine together have to look like **one cohesive pack** drawn by the
same hand.

## The canvas

A single **96×96-pixel** image with a transparent background. Origin is the
top-left; `x` increases to the right, `y` increases downward (0–95). The image is a
**3×3 grid of 32×32-pixel cells**; draw **one icon centered in each cell**, in this
order (row by row, left to right):

| Grid | Column 0 | Column 1 | Column 2 |
| --- | --- | --- | --- |
| **Row 0** | Health potion (red) | Mana potion (blue) | Steel sword |
| **Row 1** | Round wooden shield | Gold coin | Treasure chest |
| **Row 2** | Brass key | Gemmed ring | Rolled scroll |

Cell `(row, col)` spans `x` from `col×32` to `col×32 + 31` and `y` from `row×32` to
`row×32 + 31`. Keep each icon inside its cell with a pixel or two of margin — do not
let an icon clip its cell edge or bleed into a neighbor. Draw on full
**transparency** — the only opaque pixels are the icons themselves; do **not** fill
the background, and do **not** draw grid lines between the cells.

## The style (applies to every icon)

- **Chunky and outlined.** Give each icon a **bold, dark outline** all the way
  around its silhouette in the shared outline color. The icons are stout and
  simplified — big readable shapes, not fine detail.
- **Flat two-tone shading.** Fill the inside of each icon with **flat color**: one
  **lit tone** and one **shadow tone** from that item's color family, with a hard
  edge between them (no gradients, no dithering, no anti-aliasing).
- **One light, top-left.** The light comes from the **top-left** on **all nine**
  icons: put the lit tone on the upper-left faces and the shadow tone on the
  lower-right faces. A small single-pixel or few-pixel highlight glint on the
  brightest corner is welcome. Keep this light direction identical across the set —
  that consistency is what makes the nine read as one pack.

## The nine icons

1. **Health potion (red).** A rounded flask or bottle of red liquid with a small
   neck and a wooden cork or stopper on top. Red glass, a bright glass glint,
   clearly a health/healing potion.
2. **Mana potion (blue).** The same flask silhouette as the health potion but
   filled with **blue** liquid, so the two potions read as a matched pair that
   differ only in color.
3. **Steel sword.** A straight double-edged blade pointing up, a short crossguard,
   a wrapped grip, and a round pommel. Steel blade, a metal-and-wood hilt.
4. **Round wooden shield.** A round shield seen face-on: a wooden face with a metal
   rim and a metal boss (stud) in the center. Reads as a sturdy round buckler.
5. **Gold coin.** A round gold coin seen face-on, with a raised rim and a simple
   emboss (a star, a crest, or a numeral) stamped on its face. Clearly money.
6. **Treasure chest.** A closed wooden chest with a domed or flat lid, metal bands
   across it, and a metal lock plate on the front. A classic loot chest.
7. **Brass key.** A skeleton key lying at a slight diagonal: a round bow (the loop
   you hold), a straight shaft, and a toothed bit at the end. Warm brass metal.
8. **Gemmed ring.** A round metal band seen at a slight angle with a single faceted
   **gemstone** raised on top, catching the light. A jeweled ring.
9. **Rolled scroll.** A rolled-up sheet of parchment seen from the side — a
   pale rolled tube with the curled edge of the paper showing, optionally bound by
   a small band or wooden rod ends.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you). The **outline** is
shared by every icon; each item takes its **lit** and **shadow** tones from the
family noted below.

| Role | Hex |
| --- | --- |
| Outline (all icons) | `#20141c` |
| Potion red — lit | `#ff7d63` |
| Potion red — shadow | `#c9303a` |
| Potion blue — lit | `#6cbcff` |
| Potion blue — shadow | `#265fbf` |
| Steel — lit | `#e6eef3` |
| Steel — shadow | `#7d909e` |
| Gold / brass — lit | `#ffe08a` |
| Gold / brass — shadow | `#c98a1e` |
| Wood — lit | `#b87b45` |
| Wood — shadow | `#7a4522` |
| Parchment (scroll paper) | `#f0e2bd` |

Suggested family per icon (share tones freely to stay within the palette): the two
**potions** use the red / blue tones with a wooden cork; the **sword** blade is
steel with a gold guard and wood grip; the **shield** face is wood with a steel rim
and boss; the **coin** and **key** are gold / brass; the **chest** is wood with gold
bands and lock; the **ring** band is gold with a red gem (its lit / shadow tones);
the **scroll** is parchment with wood-shadow for its rolled edges and rod ends. The
red gem reuses the potion-red tones; the scroll's darker curl reuses the wood
shadow. Every dark line is the shared outline color.

## Working the tool

Lay out the nine cells first, then build each icon inside its cell: block in the
silhouette in the shadow tone, add the lit tone on the top-left faces, ring the
whole shape in the outline color, and drop in a highlight glint. Use rectangle and
short line / pixel operations for the chunky shapes and single pixels for the
outline, glints, and small details. Keep the light coming from the top-left on
every icon. Run `draw --help` for the available operations and `draw <operation>
--help` for each one's exact flags. Call `draw` once per operation and read
`canvas.png` between calls to judge it against this brief — the nine icons should
read at a glance as a clean, cohesive inventory pack on full transparency.
