# Thunderhead HUD — painting brief

You are painting the **fleet-command HUD kit** for *Thunderhead*, a naval
fleet-command strategy game. The interface is the industrial overlay a commander
reads mid-battle: a **riveted-naval** chassis of gunmetal and brass, its readouts
glowing in cold **tactical cyan**, with **warning amber** reserved for alerts. It
must read as heavy, machined hardware — bolted plate, beveled bezels, honest
rivets — not a clean flat UI.

You are painting a **kit** of five named elements, each its own document of its
own size. Every operation names the element it targets with `--element <name>`.

## The tools

You have **two** binaries, both already on your `PATH` and sharing one workspace
and one recorded operation log:

- **`paint`** — the primary **layered raster painter**: named layers, alpha
  compositing and blend modes, soft/hard/textured brushes, gradients, selections,
  masks, filters, and layer effects (bevel, inner-shadow, drop-shadow, stroke,
  glow). Use it for the painterly work — the brushed-metal shading, the cyan glow
  bloom, gradients, and grime.
- **`ui`** — the companion **crisp UI-composition tool** over the same workspace:
  exact anti-aliased vector shapes (`rect`, `rounded-rect`, `ellipse`, `line`,
  `polygon`), **text** in the fonts baked into the image (`ui fonts` lists them),
  and **nine-slice** authoring (`set-nine-slice`, `nine-slice-preview`). Use it
  for the structural, pixel-crisp parts — bezel frames, rails, the button body,
  labels, and the scalable insets.

Interleave them freely: block a plate out with `ui rounded-rect`, shade it with
`paint gradient` and `paint brush`, stamp a rivet with `ui ellipse`, label it with
`ui text`, then mark its stretch region with `ui set-nine-slice`. Both are the
**only** channel that counts — the emitted flattened per-element PNGs are the
authoritative output, and anything produced any other way is discarded and
flagged. Run `paint --help`, `ui --help`, and `<binary> <operation> --help` for
the exact contracts, and read an element's preview between calls to judge your
progress.

## The canvas

- Each element is a separate **transparent** RGBA document of its declared size
  (below), sized against a common **512×512** base frame. Origin is the top-left;
  `x` increases to the right, `y` increases downward.
- Coordinates and sizes are pixels **within the target element**, and are signed
  (a shape may sit partly off-element; the off-element part is clipped).
- Leave the chassis surrounded by transparency where the brief calls for it — the
  interface composites over the game behind it.

## Palette

Build every element from **only** these colors (name and hex). Cyan is for
tactical readouts and glow; amber is reserved for warnings, never the main trim:

| Role | Hex |
| --- | --- |
| Gunmetal chassis | `#2b313a` |
| Gunmetal shadow (recesses) | `#161a20` |
| Brass trim | `#b28a4c` |
| Brass highlight | `#e6c483` |
| Steel edge (bevel light) | `#c2ccd8` |
| Tactical cyan (readout) | `#35e2ff` |
| Cyan glow (deep) | `#0c5f78` |
| Warning amber | `#ffb43a` |
| Readout black (screen field) | `#0d1117` |
| Rivet highlight | `#ffffff` |

## The elements

Paint each of the five. For a stretchable element, author its **nine-slice**
insets with `ui set-nine-slice` (the fixed border margins that stay put while the
center and edges tile), and confirm they hold with `ui nine-slice-preview` before
you finish.

- **`command-panel`** — **512×512**. The primary bezelled readout plate: a heavy
  gunmetal chassis with a beveled brass-trimmed bezel around a recessed
  readout-black field, rivets at the corners, and a cyan readout accent (a thin
  cyan rule or header bar). Nine-slice so the beveled corners and top bezel stay
  fixed while the center readout field and edges stretch to any size:
  `left 48, right 48, top 48, bottom 48`.
- **`health-bar-frame`** — **512×96**. A wide gauge housing: a gunmetal rail with
  a brass-trimmed lip and a recessed readout-black channel where a fill bar would
  sit, with a beveled left cap and right cap and rivets on the caps. A cyan tick
  or hairline marks the channel. Nine-slice so the caps and top/bottom rails stay
  fixed while the center channel tiles to any bar length:
  `left 40, right 40, top 24, bottom 24`.
- **`minimap-bezel`** — **384×384**. A square radar surround: a thick riveted
  gunmetal frame with a brass inner ring around an empty (transparent) center
  where the live radar renders, its four corners bolted with rivets and a cyan
  bearing tick at top-center. Nine-slice so the riveted corners stay fixed while
  the framed edges tile to any minimap size: `left 48, right 48, top 48,
  bottom 48`.
- **`faction-crest`** — **256×256**. A fixed-size military naval insignia: a bold,
  centered emblem — a brass-and-gunmetal silhouette (e.g. a stylized anchor,
  thunderhead cloud, or fouled-anchor-over-lightning device) with a cyan accent —
  reading clearly as a fleet crest at a glance, not a soft blob. **No** nine-slice:
  it is never stretched.
- **`button-primary`** — **256×72**. A stretchable primary button: a rounded
  gunmetal body with a brass-trimmed beveled edge, a subtle cyan inner glow, and a
  centered steel-edge or cyan label (use `ui text` with a baked font, e.g.
  `ENGAGE`). Nine-slice so the rounded caps stay fixed while the label field
  stretches to any label width: `left 24, right 24, top 20, bottom 24`.

## Working the tools

Build each element up in sensible layers. A good pass for a plate: block the
chassis with `ui rounded-rect`, shade it with a `paint gradient` and a soft
`paint brush`, recess the readout field with a `paint layer-effect inner-shadow`,
add the brass bezel and rivets with `ui` shapes and a `paint bevel` effect, bloom
the cyan readout with a `paint layer-effect glow`, stamp any label with `ui text`,
then `ui set-nine-slice` and check `ui nine-slice-preview`. Call the binaries one
operation at a time, target each with `--element`, and read the element's preview
between calls to judge it against this brief.
