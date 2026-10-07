---
title: Voxel cases
---

A voxel case produces a 3D asset. There are eight kinds in two families: the cube
kinds `voxel-model` and `voxel-animation`, which sculpt discrete opaque cells
with the [voxel binaries](/testing/asset-generation/voxel-binaries/); and the
meshed kinds `mc-model`/`mc-animation`, `sn-model`/`sn-animation`, and
`dc-model`/`dc-animation`, which extract a surface from a signed-distance field
with the [meshing binaries](/testing/asset-generation/mesh-binaries/).

Every voxel kind declares a `[voxel]` table in place of `[canvas]`. Every
animated kind adds a `[model]` table declaring the
[required animations](/testing/asset-generation/overview/#the-rig) the model must
author. Everything on the
[Manifests overview](/testing/asset-generation/manifests/overview/) applies
unchanged.

## A static case

```toml
asset_kind = "voxel-model"

# The bounding volume the model sculpts into — the 3D analog of [canvas]. Cells
# are OPAQUE #rrggbb (no alpha) and the volume starts EMPTY.
[voxel]
width      = 32              # extent along x, in voxels (required, > 0)
height     = 32              # extent along y — up — in voxels (required, > 0)
depth      = 32              # extent along z, in voxels (required, > 0)
background = "transparent"   # PNG preview clear color only: transparent | a hex color

[tool]
binary  = "voxel"            # the binary for the kind (required)
preview = "model.png"        # where the binary writes the wgpu preview PNG on `render`

[output]
actions = "actions.json"     # the ordered op record
```

A meshed static case is identical in shape. Only the binary differs, and the
`[voxel]` table frames the signed-distance field the surface is extracted from
rather than bounding sculpted cells:

```toml
asset_kind = "dc-model"      # mc-model / sn-model are identical in shape

[voxel]
width  = 48
height = 48
depth  = 48
background = "transparent"

[tool]
binary  = "dc"               # the meshing binary: mc | sn | dc
preview = "model.png"

[output]
actions = "actions.json"     # the extracted .glb geometry is emitted automatically by core
```

## An animated case

An animated kind authors, previews, and emits each part separately, so
`[tool].preview` and `[output].actions` must carry the `{part}` token. It also
declares the `[model]` table:

```toml
asset_kind = "voxel-animation"   # or mc-animation / sn-animation / dc-animation

[voxel]
width  = 32
height = 24
depth  = 32
background = "transparent"

[tool]
binary  = "voxel-anim"                 # voxel-anim | mc-anim | sn-anim | dc-anim
preview = "parts/{part}.png"           # {part} REQUIRED for an animated kind

[output]
actions = "parts/{part}.actions.json"  # {part} REQUIRED for an animated kind

# The rig contract: the set of animations the model must author. A case declares NO
# parts and NO joints — the model invents whatever skeleton the subject needs and is
# scored on whether it worked out the right pieces and animated them.
[model]

[[model.animation]]
name      = "walk"         # stable, unique name a game plays this animation by (required)
loop      = true           # loop (true, the default) or play once and hold the last pose
auto_play = false          # false (default) = a named playable a game triggers (walk, recoil);
                           # true = plays continuously on its own (a decorative idle)
```

## The voxel table

`[voxel]` fixes the bounding volume: `width`, `height` (up), and `depth` in
voxels, each greater than zero, plus a `background` used only as the preview
PNG's clear color. The volume always starts empty, so the background never places
material. Voxel material is opaque `#rrggbb`.

For a cube case the volume bounds the sculpted cells. For a meshed case it frames
the signed-distance field the surface is extracted from. It is required for, and
only for, a voxel-family case, and replaces `[canvas]`. A voxel case declaring
`[canvas]`, or a 2D case declaring `[voxel]`, is rejected.

## Tool and output paths

`[tool].binary` is the binary for the kind: `voxel` or `voxel-anim` for the cube
kinds, and `mc`/`sn`/`dc` or `mc-anim`/`sn-anim`/`dc-anim` for the meshed kinds.
The binary a case names fixes the character of the output, a cube volume against
an `mc` low-poly, `sn` smooth, or `dc` sharp-edged surface.

Every voxel case's `[output]` names its `actions` operation log. For a meshed
case core also emits the extracted geometry to a path it provides, `mesh.glb` for
a static kind and `meshes/{part}.glb` per part for an animated one, so the
geometry is not manifest-declared. An animated kind's `preview` and `actions`
must carry `{part}`; a static kind's must not.

## The model table

`[model]` is required for, and only for, an animated kind. It declares only the
case's required `[[model.animation]]` entries. It declares no parts and no
joints: the rig's parts, joints, pivots, and ranges are model-invented at run
time with the
[rig subcommands](/testing/asset-generation/voxel-binaries/#rig-subcommands).
Resolution validates that every `[[model.animation]]` has a unique `name`.

Each `[[model.animation]]` declares an animation by identity alone:

- `name` — the stable, unique name a game plays the animation by.
- `loop` — loop, or play once and hold the last pose. Defaults to `true`.
- `auto_play` — whether the animation plays continuously on its own, such as a
  radar spin, rather than being a named playable a game triggers. Defaults to
  `false`.

The case fixes no parts, joints, period, or keyframes. The model invents whatever
rig realizes the animation and authors the motion as F-curves, with per-keyframe
`constant`/`linear`/`bezier` interpolation plus `ease-in`, `ease-out`, and
`ease-in-out` presets, choosing the period itself. The produced animations are
carried in `rig.json`, exported to glTF for a game to play, and reconciled
against these declarations. A required animation that is missing, or that never
actually animates, is a contract gap.

A rig's caller joints are the procedural interface a game drives per frame, such
as turret yaw or gun pitch, exported as machine-readable metadata. Its animations
are the baked clips a game plays. The review UI surfaces caller joints as
controls, plays the produced animations, and poses the full rig in the 3D viewer.
See [Evaluation](/testing/asset-generation/evaluation/).

## Per-variant volumes

For a voxel case the bounding volume is a variant axis. A variant may declare its
own `[voxel]` table, which replaces the case's `[voxel]` for runs of that
variant. A variant with no `[voxel]` inherits the case's volume. This is how a
case offers the same subject at several sizes: a `base` variant with no override,
plus `half` and `double` variants with their own volumes.

```toml
# variants/double.toml — the same subject in a doubled volume.
slug = "double"
name = "Double Size"

[voxel]
width  = 100                 # the case's width, doubled
height = 40
depth  = 152
background = "transparent"
```

Resolution validates a variant's `[voxel]` exactly as the case's, and rejects a
`[voxel]` on a variant of any non-voxel case. The size a variant runs at flows to
everything that reads the volume: the tool config the binary is seeded with, the
volume the produced model is scored against, and the brief.

A voxel brief therefore should not hardcode its dimensions. Write its `[[spec]]`
as a Handlebars template with a `.hbs` source, so the seeded `dest` drops the
`.hbs`. The [spec-template context](/testing/end-to-end/overview/#spec-templates)
exposes the effective volume as `{{voxel}}`: `{{voxel.width}}`,
`{{voxel.height}}`, and `{{voxel.depth}}` for the extents, and `{{voxel.maxX}}`,
`{{voxel.maxY}}`, and `{{voxel.maxZ}}` for the highest index on each axis, so an
inclusive coordinate range reads `` `0`–`{{voxel.maxX}}` ``. The same context is
available in the case's `prompt.hbs`.

Because coordinates are size-dependent, a voxel case's brief and `[[domain]]`
text should describe the form itself rather than citing specific coordinates or
extents. A reviewer judges the shape.
