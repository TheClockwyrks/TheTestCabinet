---
title: Sprite cases
---

A `sprite` case produces one small pixel image drawn onto the whole canvas. A
`sprite-sheet` case produces a set of animation frames, each a completely
separate file of the canvas size. Both are drawn with the
[drawing binaries](/testing/asset-generation/sprite-binaries/), and both are
scored on the image regenerated from the recorded action log.

Everything on the
[Manifests overview](/testing/asset-generation/manifests/overview/) applies
unchanged. This page covers the `[canvas]` table both kinds declare and the
`[sheet]` table a sprite sheet adds.

```toml
asset_kind = "sprite"        # "sprite" (the default) | "sprite-sheet"

# The image the model draws on. For a single sprite this is the whole canvas; for
# a sprite sheet it is ONE frame (every frame is a separate file of this size).
[canvas]
width  = 64                  # canvas width in pixels (required, > 0)
height = 64                  # canvas height in pixels (required, > 0)
background = "transparent"   # initial canvas state: transparent | a hex color

# `draw` for a single sprite, `draw-sheet` for a sheet.
[tool]
binary  = "draw"
preview = "canvas.png"       # a {frame} template for a sheet, e.g. "frames/{frame}.png"

[output]
actions = "actions.json"     # a {frame} template for a sheet, e.g. "frames/{frame}.actions.json"
```

## The canvas table

`[canvas]` fixes the image the model works on: its `width` and `height` in
pixels and its initial `background`. For a single sprite this is the whole
canvas; for a sprite sheet it describes one frame. Fixing it keeps runs
comparable, the same way an end-to-end build interface does.

The declared canvas is seeded to the binary as its config, so the model's drawing
operations need no canvas flags.

## The sheet table

The `[sheet]` table is required for, and only for,
`asset_kind = "sprite-sheet"`. It declares the case's frames and the named
sequences a reviewer plays back.

```toml
asset_kind = "sprite-sheet"

[tool]
binary  = "draw-sheet"
preview = "frames/{frame}.png"          # {frame} REQUIRED for a sheet

[output]
actions = "frames/{frame}.actions.json" # {frame} REQUIRED for a sheet

[sheet]

[[sheet.frame]]              # >=1 required; one declared frame
index  = 6                   # the index it is written to (draw-sheet --frame 6), unique

[[sheet.frame]]
index  = 7

[[sheet.sequence]]           # >=1 required; one named animation the UI plays back
slug   = "walk-right"        # stable slug (required, unique within the sheet)
name   = "Walk Right"        # display name (optional; default humanizes the slug)
frames = [6, 7]              # ordered frame indices (required, each a declared frame)
fps    = 4                   # playback rate in frames per second (required, > 0)
```

Each `[[sheet.frame]]` declares only the `index` it is written to, passed as
[`draw-sheet --frame`](/testing/asset-generation/sprite-binaries/). The number of
frames is however many are declared. Resolution validates that frame indices are
unique, and that each sequence has a unique non-empty `slug`, at least one
`frames` index, every index a declared frame, and `fps > 0`.

Each frame is regenerated independently, with no whole-sheet aggregate. The
named sequences are surfaced to the reviewer and played back as live animations
from the per-frame regenerated images. The sheet layout travels in the run
record, so the verdict page animates from the run alone.
