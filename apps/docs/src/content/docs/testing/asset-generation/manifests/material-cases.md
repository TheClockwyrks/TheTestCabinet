---
title: Material cases
---

A `material` case produces a
[tileable PBR material](/testing/asset-generation/overview/#pbr-materials): a set
of maps painted with the
[`texture` and `pbr` binaries](/testing/asset-generation/material-binaries/). It
declares a `[material]` table in place of `[canvas]` or `[voxel]`, and declares
no `[model]`. A case authors one material.

Everything on the
[Manifests overview](/testing/asset-generation/manifests/overview/) applies
unchanged.

```toml
asset_kind = "material"

# The maps the material carries and how they are baked.
[material]
size = 512                   # square map resolution in pixels, a power of two (required)
tile = true                  # seamless authoring: brushes/gradients/filters wrap across
                             # the map edges so it tiles without a seam (default true)
maps = ["base-color", "normal", "roughness", "metallic", "ao"]
                             # the channels the material emits; "base-color" is REQUIRED,
                             # the rest optional — a subset of: base-color | normal |
                             # roughness | metallic | ao | emissive
background = "transparent"   # preview clear color only

# `binary` names the PRIMARY painter (`texture`); the companion `pbr` binary (bake
# normal/AO, uniforms, assemble, 3D preview) ships in the SAME image and is on PATH.
[tool]
binary  = "texture"
preview = "maps/{map}.png"   # a {map} template — one preview per declared map

# A SINGLE interleaved record (each op carries --map).
[output]
actions = "actions.json"
```

## The material table

`[material]` fixes the material's output and is required for, and only for, a
material case.

- `size` is the square map resolution in pixels and must be a power of two
  greater than zero.
- `tile` selects seamless authoring, where every brush, gradient, and filter
  wraps across the map edges. It defaults to `true` and is required for
  [triplanar application](/testing/asset-generation/material-binaries/#the-triplanar-consumption-model).
- `maps` lists the channels the material emits. It must be non-empty, must
  include `base-color`, must carry no duplicates, and must otherwise draw from
  `normal`, `roughness`, `metallic`, `ao`, and `emissive`. The height channel a
  case bakes relief from is an authoring aid rather than an emitted map, so it is
  not declared.
- `background` is the preview clear color.

## Tool and output paths

`[tool].binary` names the primary painter, `texture`. The companion `pbr` binary
is baked into the same image and available on `PATH`.

`[tool].preview` carries the `{map}` token, giving one preview per declared map.
`[output].actions` is a single interleaved operation log and must not carry
`{map}`, because the two binaries share one recorded stream.

Core emits one PNG per declared map plus the `material.json` carrying the map
paths, each map's color space, and the world-space tiling scale. Neither is
manifest-declared. See
[the output contract](/testing/asset-generation/material-binaries/#the-output-contract).
