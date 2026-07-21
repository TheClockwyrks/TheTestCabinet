---
title: Sprite binaries
---

An asset-generation run draws through a **drawing binary** on its `PATH` — the
only channel for making a mark. There are two, sharing one drawing implementation:

- **`draw`** — for a [single sprite](/testing/asset-generation/manifests/): one
  32-bit RGBA canvas.
- **`draw-sheet`** — for a sprite sheet: **one separate image per frame**.
  `draw-sheet` is `draw` plus a required `--frame <index>` on every operation; the
  drawing operations and how each one rasterizes are otherwise identical.

The binaries are built from `crates/draw` and each is baked into its own
[run-container image](/components/core/execution/#containerization): `draw` into
the **sprite image** (`asset_kind = "sprite"`) and `draw-sheet` into the
**sprite-sheet image** (`asset_kind = "sprite-sheet"`), so a run carries only the
tool it uses. The same library regenerates the image after the run (see
[Evaluation](/testing/asset-generation/evaluation/)), so an image produced any
other way cannot match.

## The operations are ordinary CLI subcommands

A case seeds **no** operations schema. The drawing vocabulary is the binary's own
`--help`, and the brief tells the model to read it:

```
draw --help                 # every operation
draw fill-rect --help       # one operation's exact flags
```

Each operation is a subcommand with flags — there is no JSON. For example:

```
draw fill-rect --x 28 --y 28 --width 8 --height 1 --color "#ff4ec7"
draw fill-circle --cx 20 --cy 16 --r 8 --color "#c46bff"
draw mirror-horizontal --axis-x 32
```

The operations are: `fill-background`, `set-pixel`, `fill-rect`, `stroke-rect`,
`line`, `fill-circle`, `stroke-circle`, `flood-fill`, and `mirror-horizontal`.
Coordinates are signed (a shape may be placed partially off-canvas; the
off-canvas portion is clipped); sizes and radii are unsigned. Colors are
`#rrggbb` or `#rrggbbaa`. Operations **replace** the pixels they touch rather than
alpha-compositing, so the recorded log regenerates to an exact, order-only image.

Every drawing operation also accepts `--layer <name>`, which redirects it onto a
registered [layer](#layers) instead of the canvas itself.

## Layers

By default an operation paints straight onto the canvas, where it is
indistinguishable from everything already drawn — to move one element you must
redraw the whole image. A **layer** is a separate, independently positioned
surface you paint once and then place, so the pieces of a sprite stay separable.

```
draw register-layer --name ball --x 10 --y 6 --width 12 --height 12
draw fill-circle --layer ball --cx 6 --cy 6 --r 5 --color "#c46bff"
```

A layer is **not** the size of the image. `--width`/`--height` give its own extent
and `--x`/`--y` place its top-left corner on the canvas; a small layer paints only
where it sits, and anything falling outside the canvas is clipped. Coordinates in
an operation carrying `--layer` are **layer-local**: `--cx 6 --cy 6` above is the
centre of the 12×12 layer, not of the canvas.

Layers composite **on top of** the canvas log — first the operations you drew
directly, then each layer in `--z` order (ties broken by registration order).
Unlike the replace-pixel operations, layers composite **source-over**, so a
layer's transparent pixels let what is underneath show through and a partly
transparent color blends. That is what makes them stackable.

Registration also sets the layer's resting transform, each of which is
[animatable](#animating-layers):

| Flag | Meaning | Default |
| --- | --- | --- |
| `--x`, `--y` | top-left corner on the canvas | required |
| `--width`, `--height` | the layer's own extent | required |
| `--z` | composite order, low to high | `0` |
| `--opacity` | `0` (invisible) to `255` (opaque) | `255` |
| `--rotation` | whole degrees clockwise, about the layer's centre | `0` |
| `--scale-x`, `--scale-y` | percent, `100` = actual size | `100` |

Rotation and scale resample **nearest-neighbour** about the layer's centre, which
keeps the result crisp and exactly reproducible but — as with any pixel art — will
visibly stair-step at angles that are not multiples of 90°. Every value here is an
integer; there are no floating-point flags anywhere in the tool, so a regenerated
image is bit-identical to the preview you were shown.

Three more subcommands keep a layer editable while you iterate:

```
draw list-layers                      # every layer, its transform, and its op count
draw clear-layer --name ball          # discard its drawing ops, keep it registered
draw remove-layer --name ball         # remove the layer entirely
```

## Animating layers

`draw-sheet` adds **keyframes** on any layer transform property, so a shape you
painted once can move across the sheet's frames without being redrawn per frame.
This is the tool for motion that is awkward to hand-place frame by frame — an arc,
an overshoot, a spin.

```
draw-sheet animate-layer --layer ball --property x --frame 0  --value 2
draw-sheet animate-layer --layer ball --property x --frame 11 --value 50 --interp linear
```

`--property` is one of `x`, `y`, `opacity`, `rotation`, `scale-x`, `scale-y`, and
`--value` is that property's integer value at `--frame`. A property with no
keyframes stays at the value `register-layer` gave it; before the first keyframe
it holds the first value, and after the last it holds the last.

Each keyframe's `--interp` sets how the curve **leaves** it, using the same
[F-curve](/testing/asset-generation/voxel-binaries/#f-curves) vocabulary as the
voxel tools:

- **`constant`** holds the value until the next key (a step — the right choice for
  snapping between poses),
- **`linear`** draws a straight line to it,
- **`bezier`** (the default) draws a smooth curve shaped by tangent **handles** —
  `--handle-out <dframes,dvalue>` on this key and `--handle-in <dframes,dvalue>` on
  the next, each an offset from its own key; omit them for a smooth auto tangent,
- **`ease-in`** starts slow and accelerates into the next key, **`ease-out`** starts
  fast and decelerates, and **`ease-in-out`** eases both ends.

### Getting a curved path

A path is curved when `x` and `y` are shaped **differently** — animating both
linearly only ever produces a straight line, which is the usual reason hand-built
motion looks robotic. To throw the ball in an arc, let `x` travel at a constant
rate while `y` decelerates up and accelerates back down:

```
# x: steady left-to-right across the whole sheet
draw-sheet animate-layer --layer ball --property x --frame 0  --value 2  --interp linear
draw-sheet animate-layer --layer ball --property x --frame 11 --value 50

# y: rises to a peak at frame 5, slowing as it goes, then falls away faster
draw-sheet animate-layer --layer ball --property y --frame 0  --value 40 --interp ease-out
draw-sheet animate-layer --layer ball --property y --frame 5  --value 8  --interp ease-in
draw-sheet animate-layer --layer ball --property y --frame 11 --value 40
```

Add a slow `rotation` track over the same span and the ball tumbles as it flies.

### What belongs on a layer

A layer's painted content is **shared by every frame** — you paint it once and the
keyframes place it. So put on a layer whatever *moves without changing shape*, and
keep drawing directly into a frame's own log for whatever *changes shape between
frames*. A bouncing ball is a layer; a character's leg mid-stride is per-frame art.
Most sheets want both, and a layer op needs no `--frame` precisely because it
applies to all of them.

```
draw-sheet register-layer --name ball --x 2 --y 40 --width 12 --height 12
draw-sheet fill-circle --layer ball --cx 6 --cy 6 --r 5 --color "#c46bff"   # no --frame
draw-sheet fill-rect --frame 3 --x 0 --y 60 --width 64 --height 4 --color "#222"
```

Layers, their content, and their keyframes are recorded in a sheet-wide
`layers.json` alongside the per-frame action logs; it is seeded empty and, like the
logs, it is authoritative — the reviewed image is
[regenerated](/testing/asset-generation/evaluation/) from both together.

## How a call records and previews

Each operation appends itself to the run's **action log** and re-renders the
**preview** from the whole log, so the recorded log is always the single source of
truth and the preview always reflects it. The orchestrator seeds a
`draw.config.json` next to the workspace giving the canvas size, background, and
the log/preview paths, so an operation needs no canvas flags. A model reads the
preview between calls to judge its progress.

```
draw init    # write an empty log and a blank preview (a run starts pre-seeded)
draw render --actions <log> --out <png> --width <w> --height <h>   # regenerate a log
```

`render` reproduces the **finished image** — the action log with every
[layer](#layers) composited over it, exactly what the preview shows and what the
run is [scored](/testing/asset-generation/evaluation/) on. It reads the seeded
`layers.json` on its own; you never have to tell it that layers exist.

Two flags narrow that, for checking your own work rather than producing the asset:

```
draw render --actions <log> --out <png> --width <w> --height <h> \
    --only-layer head          # composite only this layer (repeatable)
draw render ... --no-layers    # the log alone, with nothing composited
```

## Live preview

When a run is being **watched** — driven by a [driver](/components/driver/overview/)
or the [Tauri app](/components/tauri/overview/) rather than a plain `tcab run` —
the model's drawing can be streamed to the viewer in real time, so a person sees
the sprite take shape operation by operation rather than only the finished asset.

The intermediate frames live inside the run container, out of reach of the host
while the run is in progress, and the binary's stdout is mediated by the harness —
so neither is a reliable channel. Instead the orchestrator opens a small TCP
listener on the run host and adds a `live` block to the seeded `draw.config.json`:

```jsonc
{
  "width": 64, "height": 64, "background": "transparent",
  "actions": "actions.json", "preview": "canvas.png",
  "layers": "layers.json",
  "live": {
    // the run host, reachable from the container as host.docker.internal
    "endpoint": "host.docker.internal:54123",
    "token": "…"           // an opaque per-run token echoed with each frame
  }
}
```

After each operation the binary connects back and streams the freshly rendered
frame — a one-line JSON header (`{ token, frame, operationCount, operation,
length }`) followed by the frame's raw PNG bytes. The container is given a route to
the host with `--add-host host.docker.internal:host-gateway` (both Docker and
Podman resolve `host-gateway` to a host-reachable address); the listener validates
the token, decodes the frame, and relays it to the viewer over the run's existing
[live channel](/components/driver/overview/) (the driver's event
stream, the Tauri app's preview event). For a sprite sheet each frame carries its
own index, so the viewer can show the most-recently-drawn frame and the status of
every frame at once.

Streaming is **best-effort and non-essential**: it is absent for an unwatched run
(no `live` block is seeded, and the binary no-ops), a drawing operation never fails
because the listener is slow or gone, and the frames are never recorded. The
recorded **action log** — not these previews — remains the run's authoritative
output, and the reviewed image is always [regenerated](/testing/asset-generation/evaluation/)
from it.

## `draw-sheet`: one file per frame

A sprite sheet's frames are **completely separate files**, never regions of one
image. `draw-sheet` adds a required `--frame <index>` that selects which frame an
operation draws into; that frame has its own action log and its own preview, both
`{frame}` templates the case declares (for example `frames/{frame}.actions.json`
and `frames/{frame}.png`). Coordinates are **within the frame** — there is no
shared sheet to offset into.

```
draw-sheet --help                                  # same operations, plus --frame
draw-sheet fill-circle --frame 0 --cx 20 --cy 16 --r 8 --color "#c46bff"
draw-sheet init                                    # initialize every declared frame
draw-sheet render --actions <log> --out <png> --width 32 --height 32 --frame 4
```

`draw-sheet render` takes `--frame` so it knows which frame to resolve the layers'
keyframes at; the layers themselves it picks up on its own, as `draw` does.

The seeded `draw.config.json` lists the declared frame indices and the `{frame}`
templates, so `draw-sheet init` initializes every frame and each operation
resolves its frame's files. Which frames exist and the animation sequences are
declared in the case's `[sheet]` table — see
[Manifests](/testing/asset-generation/manifests/).

The one thing that is **not** per-frame is `layers.json`: [layers](#layers) and
their [keyframes](#animating-layers) are sheet-wide, which is what lets one painted
layer move across frames. A layer operation therefore takes no `--frame`, and
changing a layer re-renders every frame's preview at once.
