---
title: UI binaries
description: The layered raster painter (`paint`) and the crisp UI-composition tool (`ui`) that a "ui" asset-generation case draws a high-resolution interface asset with, and the per-element PNG + ui.json output contract.
---

A **UI** asset-generation run (`asset_kind = "ui"`) produces a **high-resolution
interface asset** — a HUD plate, a panel, a button, a frame, an icon, insignia, a
title or a full-screen background — drawn through **two binaries** on its `PATH`,
both baked into the single **`ui` run-container image**:

- **`paint`** — a **layered raster painter**: a Photoshop-style editor with named
  layers, alpha compositing and blend modes, soft/hard/textured brushes, gradients,
  selections, masks, filters, and layer effects. It is the tool for painterly work —
  soft shading, glows, bevels, grime, gradients.
- **`ui`** — a **crisp UI-composition tool** layered over the same workspace: exact,
  anti-aliased vector shapes (rounded rectangles, strokes, polygons), **text** in
  baked fonts, and **nine-slice** authoring. It is the tool for the structural,
  pixel-crisp parts of an interface — a panel frame, a button body, a label, a set
  of scalable insets.

The two are **front-ends over one shared workspace** — the same documents, the same
layer stacks, the same operation log — so a run freely interleaves them: block a
panel out with `ui rounded-rect`, shade it with `paint gradient` and
`paint brush`, stamp a label with `ui text`, then mark its stretchable region with
`ui set-nine-slice`. Both are built from `crates/paint` and share one raster engine
and one record/preview plumbing.

Where the [`draw` binary](/testing/asset-generation/sprite-binaries/) is a small
(32–64 px) pixel-art tool with **replace-pixel** semantics and no layers, the UI
binaries paint onto a **large RGBA canvas** (typically 256–2048 px), **composite
with alpha**, and carry a full layer stack — the capabilities a professional
interface asset needs and a sprite deliberately omits.

## The workspace: elements, layers, documents

A `ui` case declares one or more **elements** — the discrete pieces of the asset. A
single-image case (a title screen, one HUD backdrop) has **one** element, the whole
[`[canvas]`](/testing/asset-generation/manifests/#ui-cases). A **UI kit** case
declares several named elements (`panel`, `button-primary`, `frame`, `icon-health`),
each its own **document** of its own size — the interface analogue of a sprite
sheet's frames, except the pieces are distinct interface parts rather than animation
frames. Every operation names the element it targets with a global `--element
<name>` (omitted when the case declares a single element).

Each element is a stack of **layers**. A layer is an RGBA raster with a `name`, an
`opacity`, a **blend mode**, a visibility flag, and an optional **mask**. Painting
and shape operations target `--layer <name>`; the tool **composites the visible
layers top-to-bottom with alpha** into the element's preview after each operation,
and **flattens** them into the emitted PNG when the run finishes. The layer stack is
an authoring convenience — the asset a game consumes is the flattened image — but it
is what makes non-destructive shading, effects, and masking practical.

## The operations are ordinary CLI subcommands

Neither binary seeds an operations schema; each binary's own `--help` is the
contract, exactly as with the [drawing](/testing/asset-generation/sprite-binaries/),
[voxel](/testing/asset-generation/voxel-binaries/), and
[mesh](/testing/asset-generation/mesh-binaries/) tools, and the brief tells the
model to read it:

```
paint --help                 # every raster operation
paint brush --help           # one operation's exact flags
ui --help                    # every composition operation
ui rounded-rect --help
```

Each operation is a subcommand with flags — there is no JSON. Colors are `#rrggbb`
or `#rrggbbaa`; coordinates and sizes are in **pixels within the target element**,
and are **signed** (a shape may sit partly off-element; the off-element portion is
clipped, never a panic).

### `paint` — the layered raster painter

- **Layers** — `add-layer --name`, `remove-layer`, `reorder-layer --to <index>`,
  `set-layer-opacity --opacity`, `set-blend-mode --mode <mode>`,
  `set-layer-visible --visible`, and `group-layers`. Blend `--mode` is one of
  `normal`, `multiply`, `screen`, `overlay`, `add`, `subtract`, `darken`,
  `lighten`, `soft-light`, `hard-light`, `color-dodge`, `color-burn`.
- **Masks** — `add-mask --layer <name>` attaches a grayscale mask; subsequent
  brush/gradient operations with `--target mask` paint into it (white reveals, black
  hides), so a layer's coverage is edited non-destructively.
- **Brushes** — `brush` stamps at a point and `stroke --points "x,y x,y …"` draws a
  smoothed polyline, both taking `--brush <round-soft|round-hard|airbrush|textured>`,
  `--size`, `--hardness`, `--flow`, `--opacity`, `--color`, `--spacing`, and an
  optional `--scatter`/`--jitter` (seeded — see [Seed and operation
  log](#seed-and-operation-log)).
- **Fills, shapes, gradients** — `fill` (whole layer or active selection), `bucket
  --tolerance` (contiguous flood), `fill-rect`, `fill-ellipse`, and `gradient
  --type <linear|radial> --stops "0:#…,1:#…" --from x,y --to x,y`.
- **Selections** — `select-rect`, `select-ellipse`, `select-lasso --points`,
  `select-none`, `invert-selection`, and `feather --radius`. While a selection is
  active every operation is **clipped to it**, so paint and fills stay inside a
  masked region.
- **Filters** — `blur --radius`, `sharpen`, `noise --amount` (seeded), `levels
  --black --white --gamma`, `curves`, `hue-sat --hue --sat --lightness`, and
  `desaturate`, each applied to the active layer (within the selection if one is
  active).
- **Layer effects** — `layer-effect --type <bevel|inner-shadow|drop-shadow|stroke|glow>`
  with the effect's parameters (size, color, angle, distance). These are the
  finishing passes that read as "professional" — a beveled panel edge, an inner
  shadow inside a recessed field, a stroke around a button.
- **Transforms** — `transform-layer --translate x,y --scale sx,sy --rotate deg`,
  `flip --axis <h|v>`, and `mirror --axis-x <x>` (reflect a half for a symmetric
  frame).

Example:

```
paint add-layer --element panel --name shade
paint gradient --element panel --layer shade --type linear --from 0,0 --to 0,320 \
  --stops "0:#2a2f45,1:#151826"
paint brush --element panel --layer shade --brush round-soft --size 64 \
  --hardness 0.2 --flow 0.4 --opacity 0.6 --color "#3d4c5a" --scatter 0.3
paint layer-effect --element panel --layer shade --type bevel --size 6 --angle 135
```

### `ui` — crisp shapes, text, and nine-slice

- **Vector shapes** — `rect`, `rounded-rect --corner-radius`, `ellipse`, `line`,
  and `polygon --points`, each with `--fill`, `--stroke`, and `--stroke-width`.
  Unlike a brush, these rasterize **anti-aliased and pixel-crisp** at any size — the
  right tool for a panel body, a button, or a frame.
- **Text** — `text --content "…" --font <name> --size --color` with optional
  `--align`, `--weight`, `--letter-spacing`, and `--wrap <width>`. Fonts are the set
  **baked into the `ui` image** (`ui fonts` lists them); text is the piece a
  painterly brush cannot produce and a labelled interface needs.
- **Nine-slice** — `set-nine-slice --element <name> --left --right --top --bottom`
  records the element's **stretchable insets**: the border margins that stay fixed
  while the center and edges tile/stretch, so a game can scale one authored panel or
  button to any size without distorting its corners. The insets travel in the
  emitted [`ui.json`](#the-output-contract). `nine-slice-preview --element <name>
  --width W --height H` renders the element **stretched** to a target size to a
  scratch preview, so the model can confirm the insets hold before finishing.

Example:

```
ui rounded-rect --element button-primary --layer base --corner-radius 12 \
  --fill "#2f6df6" --stroke "#1b3f9e" --stroke-width 2
ui text --element button-primary --layer label --content "START" --font "inter-bold" \
  --size 28 --color "#ffffff" --align center
ui set-nine-slice --element button-primary --left 16 --right 16 --top 14 --bottom 18
```

## Alpha compositing and the flattened asset

Unlike `draw`, whose operations **replace** the pixels they touch, the UI binaries
**composite with alpha**: a brush at 40% flow, a layer at 70% opacity, and a
`multiply` blend all combine as a painting tool expects. Compositing runs top layer
to bottom within each element, honoring per-layer opacity, blend mode, visibility,
and mask. The emitted asset for an element is that composite **flattened to a single
RGBA PNG**; the layer structure is recorded in the operation log (and shown in the
review UI) but is not itself the deliverable.

## Seed and operation log

Each binary's `init` records the asset's **seed** as the first entry in the shared
operation log, and per-operation seeds are **derived from it**: `init` seeds a PRNG
with the asset seed, and any operation that needs randomness (brush `--scatter`,
`noise`, a textured brush) draws its own seed from that stream by operation index.
So a model **never supplies a seed** — stochastic operations are reproducible from
the recorded log alone — but nothing about the run depends on the model choosing
random values.

The **emitted image data is the authoritative output**. The operation log is
recorded for the run record and the [live preview](#live-preview), not to
regenerate the asset for scoring: like every 3D and audio kind, a UI run is
[validated on the data it emits](/testing/asset-generation/evaluation/#ui-validation),
not by replaying its operations, and there is **no cheat-divergence check** — the
flattened PNGs a run emits are what a reviewer evaluates, however they were produced.

```
paint init          # seed the workspace, the op log, and the asset seed (a run starts pre-seeded)
paint render         # recomposite the active element's preview (usually automatic; see below)
```

## Preview

Both binaries **re-render the affected element's preview after each operation** —
2D compositing of a dirty region is cheap even at 1024², so, like the
[`draw` tools](/testing/asset-generation/sprite-binaries/) and unlike the voxel
family, rendering is **not** deferred to an on-request `render`. The orchestrator
seeds a `paint.config.json` next to the workspace giving each element's size and
background, the layer-store path, the op-log path, and the `{element}` preview
template, so an operation needs no canvas flags. A model reads an element's preview
between operations to judge its progress; `nine-slice-preview` is the one on-request
render, since a stretched preview is a separate view a model asks for.

## Live preview

When a run is being **watched** — driven by a [driver](/components/driver/overview/)
or the [Tauri app](/components/tauri/overview/) rather than a plain `tcab run` — the
model's painting is streamed to the viewer in real time, mechanically identical to
the [drawing](/testing/asset-generation/sprite-binaries/#live-preview) tool: the
orchestrator adds a `live` block (a `host.docker.internal` endpoint and an opaque
per-run token) to the seeded config, and after each operation the binary connects
back to the run host and streams a one-line JSON header (`{ token, frame,
operationCount, operation, length }`) followed by the freshly composited preview
PNG's raw bytes. The `frame` field carries the **element index**, so the viewer can
show the most-recently-painted element and the status of every element at once.
Streaming is **best-effort and non-essential** — absent for an unwatched run, never
fails an operation, and never recorded; the recorded operation log and the emitted
PNGs remain the run's authoritative output.

## The output contract

A UI run emits, **per element**, a flattened **RGBA PNG** — `canvas.png` for a
single-element case, `elements/{element}.png` for a kit — the size the case declared
for that element. Alongside them core emits a single **`ui.json`** describing the
asset for a consuming game:

- **`elements`** — one entry per element: its `name`, `width`, `height`, the emitted
  PNG path, and — when the model authored one — its **`nine_slice`** insets
  (`left`/`right`/`top`/`bottom`) marking the stretchable border.
- **`atlas`** — when a case packs its elements into a single sheet, the packed
  rectangle (`x`/`y`/`width`/`height`) of each element within it, so a game can bind
  one texture and address each piece by name.

The emitted PNGs and `ui.json` are produced automatically by core; they are **not**
manifest-declared paths (the manifest declares only the
[`actions`](/testing/asset-generation/manifests/#ui-cases) log). The
[validator](/testing/asset-generation/evaluation/#ui-validation) decodes each PNG,
confirms it is well-formed and the declared size, parses `ui.json`, and checks that
any nine-slice insets fall within their element's bounds; a reviewer judges the
rendered elements — and their nine-slice stretch previews — against the brief.
