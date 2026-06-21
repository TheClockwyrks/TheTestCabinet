---
title: Binaries
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
