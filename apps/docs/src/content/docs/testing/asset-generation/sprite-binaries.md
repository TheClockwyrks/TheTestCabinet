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
draw-sheet render --actions <log> --out <png> --width 32 --height 32
```

The seeded `draw.config.json` lists the declared frame indices and the `{frame}`
templates, so `draw-sheet init` initializes every frame and each operation
resolves its frame's files. Which frames exist and the animation sequences are
declared in the case's `[sheet]` table — see
[Manifests](/testing/asset-generation/manifests/).
