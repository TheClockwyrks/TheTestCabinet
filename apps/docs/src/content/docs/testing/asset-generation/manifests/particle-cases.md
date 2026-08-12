---
title: Particle cases
---

A particle case, `asset_kind = "particle-2d"` or `"particle-3d"`, produces a
[particle effect](/testing/asset-generation/overview/#particle-effects): the
model authors an emitter system the review UI and a game simulate live, using the
[particle binaries](/testing/asset-generation/particle-binaries/). It declares a
`[particle]` table in place of `[canvas]` or `[voxel]`, and declares no `[model]`.
A case authors one effect.

Everything on the
[Manifests overview](/testing/asset-generation/manifests/overview/) applies
unchanged.

```toml
asset_kind = "particle-3d"

# The field the effect plays in and how it is played back. A particle-2d case gives
# width/height only; particle-3d adds depth.
[particle]
width       = 48             # extent along x (required, > 0)
height      = 48             # extent along y — up (required, > 0)
depth       = 48             # extent along z (required for particle-3d; forbidden for particle-2d)
duration_ms = 1500           # the effect's length in milliseconds (required, > 0)
fps         = 60             # the preview/playback frame rate (required, finite and > 0)
loop        = false          # one-shot (an explosion, default) or looping (fire, smoke)
background  = "transparent"  # preview clear color only

[tool]
binary  = "particle-3d"      # the particle binary: particle-2d | particle-3d
preview = "effect.gif"       # where the binary writes the preview animation

[output]
actions = "actions.json"     # the recorded op record
```

## The particle table

`[particle]` fixes the field the effect plays in and is required for, and only
for, a particle case.

- `width` and `height` bound the field and must be positive. `depth` is required
  and positive for `particle-3d`, and rejected for `particle-2d`.
- `duration_ms` is the effect's length in milliseconds and must be positive.
- `fps` is the preview and playback frame rate and must be finite and positive.
- `loop` selects a looping effect such as fire or smoke over the one-shot
  default.
- `background` is the preview clear color.

There is no simulation seed. A particle effect is simulated live rather than
baked, so it varies slightly from one play to the next, exactly as a real
particle editor plays a system.

Core emits the authored `system.json`, the emitter, force, and curve definition
the review UI and a game simulate live. It is not manifest-declared.
