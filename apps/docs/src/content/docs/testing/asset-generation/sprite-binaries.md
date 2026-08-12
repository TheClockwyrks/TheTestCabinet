---
title: Sprite binaries
---

A sprite asset-generation run draws through a drawing binary on its `PATH`. That
binary is the only channel for making a mark. Two binaries share one drawing
implementation, built from `crates/draw`:

- `draw` draws a single sprite: one 32-bit RGBA canvas.
- `draw-sheet` draws a sprite sheet: one separate image per frame. It is `draw`
  plus a required `--frame <index>` on every drawing operation, and it adds
  keyframe animation of layers.

Each binary is baked into its own
[run-container image](/components/core/execution/#containerization): `draw` into
`test-cabinet-sprite` (`asset_kind = "sprite"`) and `draw-sheet` into
`test-cabinet-sprite-sheet` (`asset_kind = "sprite-sheet"`), so a run carries
only the tool it uses. After the run, core regenerates each frame from its
recorded log through the same library and compares the result to the model's
preview. See [Evaluation](/testing/asset-generation/evaluation/).

## Drawing operations

A case seeds no operations schema. The drawing vocabulary is the binary's own
`--help`, and the brief tells the model to read it:

```
draw --help                 # every operation
draw fill-rect --help       # one operation's exact flags
```

Each operation is a subcommand with flags:

```
draw fill-rect --x 28 --y 28 --width 8 --height 1 --color "#ff4ec7"
draw fill-circle --cx 20 --cy 16 --r 8 --color "#c46bff"
draw mirror-horizontal --axis-x 32
```

The operations are `fill-background`, `set-pixel`, `fill-rect`, `stroke-rect`,
`line`, `fill-circle`, `stroke-circle`, `flood-fill`, and `mirror-horizontal`.
Coordinates are signed, so a shape may be placed partially off-canvas and the
off-canvas portion is clipped. Sizes and radii are unsigned. Colors are
`#rrggbb` or `#rrggbbaa`. An operation replaces the pixels it touches, so the
recorded log regenerates to an exact, order-only image.

Every drawing operation also accepts `--layer <name>`, which redirects it onto a
registered layer instead of the canvas itself.

## Layers

An operation paints straight onto the canvas by default, where it is
indistinguishable from everything already drawn. A layer is a separate,
independently positioned surface, painted once and then placed, so the pieces of
a sprite stay separable.

```
draw register-layer --name ball --x 10 --y 6 --width 12 --height 12
draw fill-circle --layer ball --cx 6 --cy 6 --r 5 --color "#c46bff"
```

A layer carries its own extent. `--width`/`--height` give that extent and
`--x`/`--y` place its top-left corner on the canvas. A small layer paints only
where it sits, and anything falling outside the canvas is clipped. Coordinates
in an operation carrying `--layer` are layer-local, so `--cx 6 --cy 6` above is
the centre of the 12×12 layer rather than of the canvas.

Layers composite on top of the canvas log: first the operations drawn directly,
then each layer in `--z` order, ties broken by registration order. A layer
composites source-over, so its transparent pixels let what is underneath show
through and a partly transparent color blends. That is what makes layers
stackable.

Registration also sets the layer's resting transform, each property of which is
[animatable](#animating-layers):

| Flag | Meaning | Default |
| --- | --- | --- |
| `--x`, `--y` | top-left corner on the canvas | required |
| `--width`, `--height` | the layer's own extent | required |
| `--z` | composite order, low to high | `0` |
| `--opacity` | `0` (invisible) to `255` (opaque) | `255` |
| `--rotation` | whole degrees clockwise, about the layer's centre | `0` |
| `--scale-x`, `--scale-y` | percent, `100` = actual size | `100` |

Rotation and scale resample nearest-neighbour about the layer's centre, which
keeps the result crisp and stair-steps at angles that are not multiples of 90°.
Every value is an integer and every transform runs in fixed point, so a
regenerated image is bit-identical to the preview the model was shown.

Three more subcommands keep a layer editable while the model iterates:

```
draw list-layers                      # every layer, its transform, and its op count
draw clear-layer --name ball          # discard its drawing ops, keep it registered
draw remove-layer --name ball         # remove the layer entirely
```

## Animating layers

`draw-sheet` adds keyframes on any layer transform property, so a shape painted
once moves across the sheet's frames without being redrawn per frame. This is
the tool for motion that is awkward to hand-place frame by frame, such as an
arc, an overshoot, or a spin.

```
draw-sheet animate-layer --layer ball --property x --frame 0  --value 2
draw-sheet animate-layer --layer ball --property x --frame 11 --value 50 --interp linear
```

`--property` is one of `x`, `y`, `opacity`, `rotation`, `scale-x`, `scale-y`,
and `--value` is that property's integer value at `--frame`. A property with no
keyframes stays at the value `register-layer` gave it. Before the first keyframe
it holds the first value, and after the last it holds the last.
`clear-keyframes --layer <name> [--property <p>]` drops keyframes and returns
those properties to their resting values.

Each keyframe's `--interp` sets how the curve leaves it, using the same F-curve
vocabulary as the voxel tools:

- `constant` holds the value until the next key, which is the right choice for
  snapping between poses.
- `linear` draws a straight line to it.
- `bezier`, the default, draws a smooth curve shaped by tangent handles.
  `--handle-out <dframes,dvalue>` on this key and `--handle-in <dframes,dvalue>`
  on the next are each an offset from their own key. Omit them for a smooth auto
  tangent.
- `ease-in` starts slow and accelerates into the next key, `ease-out` starts
  fast and decelerates, and `ease-in-out` eases both ends.

### Curved paths

A path is curved when `x` and `y` are shaped differently. Animating both
linearly produces a straight line, which is the usual reason hand-built motion
looks robotic. To throw a ball in an arc, let `x` travel at a constant rate
while `y` decelerates up and accelerates back down:

```
# x: steady left-to-right across the whole sheet
draw-sheet animate-layer --layer ball --property x --frame 0  --value 2  --interp linear
draw-sheet animate-layer --layer ball --property x --frame 11 --value 50

# y: rises to a peak at frame 5, slowing as it goes, then falls away faster
draw-sheet animate-layer --layer ball --property y --frame 0  --value 40 --interp ease-out
draw-sheet animate-layer --layer ball --property y --frame 5  --value 8  --interp ease-in
draw-sheet animate-layer --layer ball --property y --frame 11 --value 40
```

A slow `rotation` track over the same span makes the ball tumble as it flies.

### Layer content

A layer's painted content is shared by every frame: it is painted once and the
keyframes place it. Put on a layer whatever moves without changing shape, and
draw directly into a frame's own log whatever changes shape between frames. A
bouncing ball is a layer; a character's leg mid-stride is per-frame art. Most
sheets want both, and a layer operation needs no `--frame` precisely because it
applies to all of them.

```
draw-sheet register-layer --name ball --x 2 --y 40 --width 12 --height 12
draw-sheet fill-circle --layer ball --cx 6 --cy 6 --r 5 --color "#c46bff"   # no --frame
draw-sheet fill-rect --frame 3 --x 0 --y 60 --width 64 --height 4 --color "#222"
```

Layers, their content, and their keyframes live in a sheet-wide `layers.json`
alongside the per-frame action logs. It is seeded empty and, like the logs, it
is authoritative: the reviewed image is regenerated from both together.

## Recording and preview

Each operation appends itself to the run's action log and re-renders the preview
from the whole log, so the recorded log is the single source of truth and the
preview reflects it. The orchestrator seeds a `draw.config.json` next to the
workspace giving the canvas size, background, and the log, preview, and layer
paths, so an operation needs no canvas flags. A model reads the preview between
calls to judge its progress.

```
draw init    # write an empty log and a blank preview (a run starts pre-seeded)
draw render --actions <log> --out <png> --width <w> --height <h>   # regenerate a log
```

`render` reproduces the finished image: the action log with every layer
composited over it, which is what the preview shows and what the run is
[scored](/testing/asset-generation/evaluation/) on. It reads the seeded
`layers.json` on its own.

Two flags narrow that, for checking one piece of the work:

```
draw render --actions <log> --out <png> --width <w> --height <h> \
    --only-layer head          # composite only this layer (repeatable)
draw render ... --no-layers    # the log alone, with nothing composited
```

## Live preview

A run driven by a [driver](/components/driver/overview/) or the
[Tauri app](/components/tauri/overview/) is watched, and the model's drawing is
streamed to the viewer in real time so a person sees the sprite take shape
operation by operation.

The intermediate frames live inside the run container and the binary's stdout is
mediated by the harness, so the orchestrator opens a TCP listener on the run
host and adds a `live` block to the seeded `draw.config.json`:

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
frame: a one-line JSON header (`{ token, frame, operation, operationCount,
length }`) followed by the frame's raw PNG bytes. The container is given a route
to the host with `--add-host host.docker.internal:host-gateway`, which both
Docker and Podman resolve to a host-reachable address. The listener validates
the token, decodes the frame, and relays it to the viewer over the run's
existing live channel. For a sprite sheet each frame carries its own index, so
the viewer shows the most-recently-drawn frame and the status of every frame at
once.

Streaming is best-effort. It is absent for an unwatched run, which seeds no
`live` block, a drawing operation succeeds whether or not the listener responds,
and the frames are never recorded. The recorded action log remains the run's
authoritative output, and the reviewed image is always
[regenerated](/testing/asset-generation/evaluation/) from it.

## Sprite sheets: one file per frame

A sprite sheet's frames are separate files rather than regions of one image.
`draw-sheet` adds a required `--frame <index>` selecting which frame an
operation draws into. That frame has its own action log and its own preview,
both `{frame}` templates the case declares, for example
`frames/{frame}.actions.json` and `frames/{frame}.png`. Coordinates are within
the frame.

```
draw-sheet --help                                  # same operations, plus --frame
draw-sheet fill-circle --frame 0 --cx 20 --cy 16 --r 8 --color "#c46bff"
draw-sheet init                                    # initialize every declared frame
draw-sheet render --actions <log> --out <png> --width 32 --height 32 --frame 4
```

`draw-sheet render` takes `--frame` so it knows which frame to resolve the
layers' keyframes at. It picks up the layers themselves on its own, as `draw`
does.

The seeded `draw.config.json` lists the declared frame indices and the `{frame}`
templates, so `draw-sheet init` initializes every frame and each operation
resolves its frame's files. Which frames exist and the animation sequences are
declared in the case's `[sheet]` table. See
[Sprite cases](/testing/asset-generation/manifests/sprite-cases/).

`layers.json` is the one artifact that is not per-frame. Layers and their
keyframes are sheet-wide, which is what lets one painted layer move across
frames. A layer operation therefore takes no `--frame`, and changing a layer
re-renders every frame's preview at once.
