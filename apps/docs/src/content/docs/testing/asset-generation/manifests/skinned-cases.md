---
title: Skinned cases
---

A skinned case, `asset_kind = "mc-skinned"`, `"sn-skinned"`, or `"dc-skinned"`,
produces a
[character](/testing/asset-generation/overview/#skinned-characters): a single
continuous skin bound to a model-invented skeleton, deforming across its joints.
It is built with the
[skinned binaries](/testing/asset-generation/skinned-binaries/).

Its manifest is a meshed animated case with one difference. The model builds one
whole-body field rather than a field per part, so `[tool].preview` and
`[output].actions` are single files rather than `{part}` templates even though it
is an animated kind carrying a `[model]` table.

Everything on the
[Manifests overview](/testing/asset-generation/manifests/overview/) applies
unchanged.

```toml
# A skinned character (asset_kind = "sn-skinned"; mc-skinned / dc-skinned differ
# only in the binary and its surface character).
asset_kind = "sn-skinned"

[voxel]
width  = 40                  # the field bounds — the same volume table a meshed case
height = 48                  # frames, here bounding the one whole-body field the skin
depth  = 24                  # is extracted from
background = "transparent"

[tool]
binary  = "sn-skin"          # the skinned binary: mc-skin | sn-skin | dc-skin
preview = "model.png"        # a SINGLE file — NOT a {part} template (one field, one mesh)

[output]
actions = "actions.json"     # a SINGLE op log — NOT a {part} template

# The REQUIRED animations, declared by identity alone. The skeleton, its bones,
# joints, and per-vertex binding are all model-invented at run time.
[model]

[[model.animation]]
name      = "walk"
loop      = true
auto_play = false
```

A skinned case declares a `[voxel]` volume bounding the field, exactly as a
[meshed case](/testing/asset-generation/manifests/voxel-cases/) does, and that
volume is a variant axis in the same way. Its `[model]` table declares only the
required animations, again exactly as a meshed animated case does. The skeleton,
joints, and weights are the model's to invent.

Core emits the skinned `mesh.glb`, carrying the geometry plus the glTF skin of
per-vertex bone weights and inverse-bind matrices, and the `rig.json`, carrying
the skeleton, the joint interface, and the F-curve animations. Neither is
manifest-declared.
