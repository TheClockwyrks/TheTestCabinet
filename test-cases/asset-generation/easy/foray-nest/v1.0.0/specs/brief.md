# Foray Nest — drawing brief

You are drawing the **Foray nest**, a single 16×16 sprite for *Foray*, a
top-down ant-colony raiding game. Two colonies raid each other's territory; the
**nest is a colony's home tile** — the spawn mound a raider must reach to bank a
carried seed, and the heart a soldier defends. You are drawing the *nest tile*,
the same sprite for either colony (see **Palette** for why it is drawn in
neutral grey).

## The canvas

- **16×16 pixels**, transparent background. Origin is the top-left; `x`
  increases to the right, `y` increases downward (coordinates 0–15).
- The nest is a **fixed tile seen from directly above** (top-down), so draw it
  **centered and roughly symmetric**, filling most of the 16×16 cell with about
  a pixel of margin — it sits in one board tile, never clipped at the edge.

## The form

The nest reads, at a glance, as a **colony's home mound with an entrance**:

- **Mound:** a rounded, raised mound filling most of the tile — a domed
  earthwork built up in concentric rings (a darker outer rim, a mid mound body,
  a lighter raised ring) so it reads as a 3-D mound from above, not a flat disc.
- **Entrance:** a clear **dark entrance hole** at the center — the tunnel mouth
  the colony pours in and out of. It is the focal point and must read as an
  opening, not a dot.
- **Accent ring:** a bright ring or rim around the entrance so the home tile
  reads as occupied and important, distinct from plain ground.

## Palette

This sprite is **recolored per colony at runtime by a palette swap**, so you
draw it **once in a neutral grey ramp** — never in red or blue. Use only these
colors (the drawing is regenerated pixel-for-pixel, so stray or off-palette
colors and anti-aliased fringes count against you):

| Role | Hex | Notes |
| --- | --- | --- |
| Mound, darkest rim | `#3a3a3a` | recolorable — becomes the colony's dark tone |
| Mound, mid body | `#6a6a6a` | recolorable — the main mound fill |
| Mound, raised ring | `#9a9a9a` | recolorable — the lighter raised highlight |
| Accent ring | `#cccccc` | recolorable — the brightest rim around the entrance |
| Entrance / outline | `#0a0806` | fixed dark; the entrance hole and outline, not recolored |

The four `#3a3a3a`/`#6a6a6a`/`#9a9a9a`/`#cccccc` greys are the **recolorable
ramp** — remapped to the colony's red or blue ramp at draw time, so the nest
reads as a red or blue home without redrawing. The `#0a0806` entrance and outline
stay dark for both colonies. Do not use any other color.

## Working the tool

Build the sprite up in sensible layers — the dark outer rim, then the mid mound
body, the lighter raised ring, the bright accent ring, and finally the dark
entrance hole at the center — using plain canvas coordinates (0–15). Run `draw
--help` for the available operations (filling and stroking circles and
rectangles, lines, single pixels, flood fill, and a horizontal mirror) and `draw
<operation> --help` for each one's exact flags. Because the mound is roughly
symmetric you may draw one half and use the horizontal mirror to complete it.
Call `draw` once per operation and read `canvas.png` between calls to judge your
progress against this brief.
