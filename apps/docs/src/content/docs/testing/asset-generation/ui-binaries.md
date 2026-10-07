---
title: UI binaries
description: The layered raster painter (`paint`) and the crisp UI-composition tool (`ui`) a "ui" asset-generation case draws a high-resolution interface asset with, and the per-element PNG + ui.json output contract.
---

A UI asset-generation run (`asset_kind = "ui"`) produces a high-resolution
interface asset: a HUD plate, a panel, a button, a frame, an icon, insignia, a
title, or a full-screen background. Two binaries draw it, both baked into the
single `ui` run-container image and both on the run's `PATH`.

- `paint` is a layered raster painter. It carries named layers, alpha
  compositing and blend modes, soft/hard/textured brushes, gradients,
  selections, masks, filters, and layer effects, and it does the painterly work:
  shading, glows, bevels, grime, gradients.
- `ui` is a crisp composition tool over the same workspace. It carries
  anti-aliased vector shapes, text in baked fonts, and nine-slice authoring, and
  it does the structural parts of an interface: a panel frame, a button body, a
  label, a set of scalable insets.

Both are built from `crates/paint` and share one raster engine, one layer store,
one operation log, and one seeded config, so a run interleaves them freely. A
run blocks a panel out with `ui rounded-rect`, shades it with `paint gradient`
and `paint brush`, stamps a label with `ui text`, then marks its stretchable
region with `ui set-nine-slice`.

## Elements, layers, and documents

A `ui` case declares one or more elements, the discrete pieces of the asset. A
single-image case (a title screen, one HUD backdrop) has one implicit element
named `canvas`, the whole `[canvas]` size. A UI-kit case declares several named
elements (`panel`, `button-primary`, `frame`, `icon-health`), each its own
document of its own size. Every operation names the element it targets with a
global `--element <name>`, omitted when the case declares a single element.

Each element is a stack of layers. A layer is an RGBA raster with a name, an
opacity, a blend mode, a visibility flag, and an optional mask. Painting and
shape operations target `--layer <name>`. The binaries composite the visible
layers with alpha into the element's PNG after each operation, and that
composite is the emitted asset. The layer stack is an authoring convenience that
makes non-destructive shading, effects, and masking practical.

## Operations

Each binary's own `--help` is the contract, and the brief tells the model to
read it:

```
paint --help                 # every raster operation
paint brush --help           # one operation's exact flags
ui --help                    # every composition operation
ui rounded-rect --help
```

Every operation is a subcommand with flags. Colors are `#rrggbb` or `#rrggbbaa`.
Coordinates and sizes are in pixels within the target element and are signed, so
a shape may sit partly off-element; the off-element portion is clipped.

### `paint` — the layered raster painter

- Layers: `add-layer --name`, `remove-layer --layer`,
  `reorder-layer --layer --to <index>`, `set-layer-opacity --layer --opacity`,
  `set-blend-mode --layer --mode`, `set-layer-visible --layer --visible`, and
  `group-layers --layer <name> --layer <name> [--name]`, which merges the named
  layers into one. `--mode` is one of `normal`, `multiply`, `screen`, `overlay`,
  `add`, `subtract`, `darken`, `lighten`, `soft-light`, `hard-light`,
  `color-dodge`, `color-burn`.
- Masks: `add-mask --layer <name>` attaches a grayscale mask. A brush, stroke,
  fill, or gradient carrying `--mask` paints into it rather than the layer, so a
  layer's coverage is edited non-destructively.
- Brushes: `brush` stamps at `--x --y`, and `stroke --points "x,y x,y …"` draws a
  smoothed polyline. Both take
  `--brush <round-soft|round-hard|airbrush|textured>`, `--size`, `--hardness`,
  `--flow`, `--opacity`, `--color`, `--spacing`, `--scatter`, and `--jitter`.
- Fills, shapes, gradients: `fill` covers the whole layer or the active
  selection, `bucket --x --y --tolerance` flood-fills a contiguous region, and
  `fill-rect`, `fill-ellipse`, and
  `gradient --type <linear|radial> --stops "0:#…,1:#…" --from x,y --to x,y`
  cover the rest.
- Selections: `select-rect`, `select-ellipse`, `select-lasso --points`,
  `select-none`, `invert-selection`, and `feather --radius`. While a selection is
  active every operation is clipped to it.
- Filters, each applied to the target layer within the active selection:
  `blur --radius`, `sharpen`, `noise --amount`,
  `levels --black --white --gamma`, `curves --amount`,
  `hue-sat --hue --sat --lightness`, and `desaturate`.
- Layer effects:
  `layer-effect --type <bevel|inner-shadow|drop-shadow|stroke|glow>` with
  `--size`, `--color`, `--angle`, and `--distance`. These are the finishing
  passes that read as professional: a beveled panel edge, an inner shadow inside
  a recessed field, a stroke around a button.
- Transforms: `transform-layer --translate x,y --scale sx,sy --rotate deg`,
  `flip --axis <h|v>`, and `mirror --axis-x <x>`, which reflects the left half
  onto the right for a symmetric frame.

```
paint add-layer --element panel --name shade
paint gradient --element panel --layer shade --type linear --from 0,0 --to 0,320 \
  --stops "0:#2a2f45,1:#151826"
paint brush --element panel --layer shade --brush round-soft --size 64 --x 96 --y 40 \
  --hardness 0.2 --flow 0.4 --opacity 0.6 --color "#3d4c5a" --scatter 0.3
paint layer-effect --element panel --layer shade --type bevel --size 6 --angle 135
```

### `ui` — crisp shapes, text, and nine-slice

- Vector shapes: `rect`, `rounded-rect --corner-radius`, `ellipse`, `line`, and
  `polygon --points`, each with `--fill`, `--stroke`, and `--stroke-width`.
  These rasterize anti-aliased and pixel-crisp at any size, so they are the tool
  for a panel body, a button, or a frame.
- Text: `text --content "…" --font <name> --size --color --x --y`, with optional
  `--align <left|center|right>`, `--weight-bold`, `--letter-spacing`, and
  `--wrap <width>`. Fonts are the set baked into the `ui` image, listed by
  `ui fonts`.
- Nine-slice: `set-nine-slice --left --right --top --bottom` records the
  element's stretchable insets, the border margins that stay fixed while the
  center and edges stretch. A game scales one authored panel or button to any
  size without distorting its corners. The insets travel in the emitted
  `ui.json`.
- Stretch preview: `nine-slice-preview --width W --height H [--out <path>]`
  renders the element stretched to a target size, so the model confirms the
  insets hold before finishing. This is the one on-request render.

```
ui rounded-rect --element button-primary --layer base --x 0 --y 0 \
  --width 256 --height 72 --corner-radius 12 \
  --fill "#2f6df6" --stroke "#1b3f9e" --stroke-width 2
ui text --element button-primary --layer label --content "START" --font "inter-bold" \
  --size 28 --color "#ffffff" --align center --x 128 --y 22
ui set-nine-slice --element button-primary --left 16 --right 16 --top 14 --bottom 18
```

## Alpha compositing and the flattened asset

The UI binaries composite with alpha: a brush at 40% flow, a layer at 70%
opacity, and a `multiply` blend all combine as a painting tool expects.
Compositing runs top layer to bottom within each element, honoring per-layer
opacity, blend mode, visibility, and mask. The emitted asset for an element is
that composite flattened to a single RGBA PNG. The layer structure lives in the
operation log and the review UI.

## Seed and operation log

`init` records the asset's seed as the first entry in the shared operation log,
and per-operation seeds derive from it: any operation that needs randomness
(brush `--scatter` or `--jitter`, `noise`, a textured brush) draws its seed from
the asset seed and its own index in the log. A model never supplies a seed, and
replaying the recorded log reproduces the same stochastic result.

The emitted image data is the authoritative output. A UI run is
[validated on the data it emits](/testing/asset-generation/evaluation/#ui-validation)
rather than by replaying its operations, so the flattened PNGs a run emits are
what a reviewer evaluates.

```
paint init          # seed the workspace, the op log, and the asset seed
paint render        # recomposite every element's preview from the log
```

A run starts pre-seeded: the orchestrator writes an empty operation log and a
blank starting PNG per element, so the model reads an empty surface before its
first operation.

## Preview

Both binaries recomposite the affected element after each operation, because 2D
compositing is cheap even at 1024². The recomposited PNG is both the preview the
model reads between operations and the emitted asset. The orchestrator seeds a
`paint.config.json` next to the workspace giving each element's size and
background, the operation-log path, the `ui.json` path, and the `{element}`
preview template, so an operation needs no canvas flags.

## Live preview

When a run is watched, driven by a [driver](/components/driver/overview/)
rather than a plain `tcab run`, the
model's painting streams to the viewer in real time. The orchestrator adds a
`live` block to the seeded config carrying a `host.docker.internal` endpoint and
an opaque per-run token. After each operation the binary connects back to the run
host and streams a one-line JSON header
(`{ token, frame, operation, operationCount, length }`) followed by the freshly
composited PNG's raw bytes. The `frame` field carries the element index, so the
viewer shows the most-recently-painted element and the status of every element at
once.

Streaming is best-effort: it is absent for an unwatched run, it never fails an
operation, and it is never recorded. The recorded operation log and the emitted
PNGs remain the run's authoritative output.

## The output contract

A UI run emits one flattened RGBA PNG per element at the case's `[tool].preview`
path, `canvas.png` for a single-element case and `elements/{element}.png` for a
kit, at the size the case declared for that element. Alongside them the binaries
emit a single `ui.json` describing the asset for a consuming game. It carries an
`elements` array with one entry per element: its `name`, `width`, `height`, the
emitted PNG path, and, when the model authored one, its `nine_slice` insets
(`left`/`right`/`top`/`bottom`).

The emitted PNGs and `ui.json` are produced by the binaries at the paths core
seeds; the manifest declares only the operation log. The
[validator](/testing/asset-generation/evaluation/#ui-validation) decodes each
PNG, confirms it is well-formed and the declared size, parses `ui.json`, and
checks that any nine-slice insets fall within their element's bounds. A reviewer
judges the rendered elements and their nine-slice stretch previews against the
brief.
