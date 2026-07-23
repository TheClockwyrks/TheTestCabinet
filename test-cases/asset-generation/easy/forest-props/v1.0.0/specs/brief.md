# Forest Prop Set — drawing brief

You are drawing a **forest prop set**: a **single 96×96 sprite sheet** of eight 2D
scenery decorations for a woodland game scene. Each prop is a small piece of nature
a level designer scatters through a forest — trees, foliage, rocks, and ground
detail. The look is **storybook**: rounded, friendly forms with soft shading and a
clean silhouette, the kind of hand-drawn set you would see decorating a cozy
side-scroller or a top-down adventure map.

## The canvas

- A single **96×96-pixel** image with a transparent background. Origin is the
  top-left; `x` increases to the right, `y` increases downward (0–95).
- Draw on full **transparency** — the only opaque pixels are the props themselves.
  Do **not** fill the background.
- Lay the eight props out **within** the frame with a little space between them so
  each reads on its own. They may be **varied sizes** — a tree is bigger than a
  mushroom — so this is not a strict grid; a loose arrangement is fine. Leave a
  pixel or two of margin so **nothing is clipped flat against an edge** of the
  canvas.

## The props

Draw all **eight** of these, each as its own small object seen from a gentle
side-on storybook angle:

1. **Round leafy tree** — a single trunk rising to a big, round, cloud-like leafy
   canopy. The canopy is a rounded green mass with a lighter top-left highlight and
   a darker underside; a short brown trunk beneath it.
2. **Pine tree** — a tall evergreen: a narrow brown trunk under a stack of two or
   three triangular tiers of dark pine needles that taper to a point at the top.
   Clearly a conifer, distinct from the round leafy tree.
3. **Leafy bush** — a low, wide clump of foliage with no visible trunk: two or
   three overlapping rounded green lobes with a highlight on top and a shaded base,
   smaller and squatter than the trees.
4. **Cluster of grass tufts** — a small clump of upright grass blades fanning out
   from a common base, a few blades taller than the rest, in the bright grass
   green. Just ground grass, no flowers.
5. **Mossy boulder** — a rounded grey rock with a lit top-left and a shaded
   underside, topped with a couple of soft **moss** patches in green clinging to
   its upper surface.
6. **Red mushroom cluster** — two or three toadstools of different heights sharing
   a patch of ground: cream stems under domed **red** caps, each cap dotted with a
   few pale cream spots.
7. **Small flower patch** — a low spray of a few simple flowers on short green
   stems: rounded **pink** petals around a **yellow** center, with a small green
   leaf or two at the base.
8. **Tree stump** — a short, cut-off trunk: brown bark sides with a lighter,
   flat **cut-wood top** showing a ring or two, and a small **moss** patch on the
   rim so it matches the boulder.

Give each prop a sense of volume with a light side and a shadow side (a lighter
tone up and to the left, a darker tone on the lower-right), so the set reads as
softly shaded rather than flat. Keep silhouettes **crisp** — a clean edge against
transparency, no stray specks and no soft fringe.

The key read: eight clearly different forest props that obviously belong to **one
matched set** — same rounded storybook style, same palette, each instantly
recognizable as what it is.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Leaf highlight | `#a7d977` |
| Leaf body | `#6fb04a` |
| Leaf shadow | `#4c8a39` |
| Pine needle | `#3e7d4f` |
| Pine shadow | `#2b5a39` |
| Grass blade | `#7cc24f` |
| Trunk / bark | `#9c6b3f` |
| Bark shadow | `#6e4826` |
| Cut wood (stump top) | `#caa06e` |
| Rock grey | `#b3b8bf` |
| Rock shadow | `#7c828b` |
| Moss | `#7fa94e` |
| Flower petal (pink) | `#e87fb0` |
| Flower center (yellow) | `#f4d35e` |
| Mushroom cap (red) | `#d1443b` |
| Cap spot / stem (cream) | `#f2e6c9` |

Leaf tones carry the round tree and bush; pine tones carry the pine tree; grass
carries the tuft cluster and flower stems; the browns carry the trunks and stump;
the greys carry the boulder; moss ties the boulder and stump together; pink and
yellow carry the flowers; red and cream carry the mushrooms.

## Working the tool

Rough out the placement of the eight props on the frame first, then build each one
up: block in its main mass in the mid tone, add the lighter highlight on the upper
left and the darker shadow on the lower right, then the small details (bark, moss
patches, mushroom spots, flower centers, grass blade tips). Use rectangle and
short line or single-pixel operations to shape the rounded silhouettes and place
the details. Run `draw --help` for the available operations and
`draw <operation> --help` for each one's exact flags. Call `draw` once per
operation and read `canvas.png` between calls to judge it against this brief — it
should read at a glance as one cohesive storybook set of eight forest props on full
transparency, each crisp and clearly itself.
