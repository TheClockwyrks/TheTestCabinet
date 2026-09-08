---
title: Material binaries
description: The seamless map painter (`texture`) and the PBR derivation/assembly tool (`pbr`) a "material" asset-generation case builds a tileable PBR material with, the triplanar consumption model, and the per-map PNG + material.json output contract.
---

A material asset-generation run (`asset_kind = "material"`) produces a tileable
PBR material: the set of maps that dresses a 3D surface, a base color, a normal
map for surface relief, and the scalar maps a physically-based shader reads. It
is the kind that lets a [meshed model](/testing/asset-generation/mesh-binaries/)
read as painted metal, worn stone, or scuffed hull plating. Two binaries build
it, both baked into the single `material` run-container image and both on the
run's `PATH`.

- `texture` is a seamless raster map painter. It paints one square map at a time
  and every brush, gradient, filter, and generator wraps toroidally across the
  map's edges, so a stroke that runs off the right continues on the left and the
  map tiles without a seam. It adds the procedural generators material work
  leans on.
- `pbr` derives and assembles. It bakes a normal map, ambient occlusion, and
  curvature from a painted height map, sets uniform scalar maps, writes the
  `material.json` that binds the maps together, and renders a lit 3D preview of
  the material on a test surface.

Both are built from `crates/paint` and share one raster engine, one operation
log, and one seeded config.

## Material channels

The case's `[material]` table declares the channels the material emits. Every
material carries `base-color`; a case may declare any of the rest.

| Channel      | What it encodes                                   | Color space |
| ------------ | ------------------------------------------------- | ----------- |
| `base-color` | the surface albedo (required)                     | sRGB        |
| `normal`     | tangent-space surface relief (RGB-encoded normal) | linear      |
| `roughness`  | microfacet roughness, 0 = mirror … 1 = matte      | linear      |
| `metallic`   | dielectric (0) vs. metal (1)                      | linear      |
| `ao`         | baked ambient occlusion                           | linear      |
| `emissive`   | self-illumination color                           | sRGB        |

Each channel is an independent square map of the case's `size`, edited as its own
layered document and selected with a global `--map <channel>` on every operation
(default `base-color`). Two further channels, `height` and `curvature`, are
always present in the workspace as authoring scratch. A model paints relief into
`height` and bakes the normal and occlusion from it rather than hand-painting a
normal map. Neither scratch channel is emitted.

Color space is recorded in `material.json`. `base-color` and `emissive` are sRGB
because they carry color; the rest are linear because they carry data. The tools
tag each map accordingly so a consumer samples it right.

## Operations

Each binary's `--help` is the contract, and the brief tells the model to read it:

```
texture --help               # every map-painting operation
texture noise --help
pbr --help                   # bake, uniform, assemble, render
pbr bake-normal --help
```

### `texture` — seamless map painting

`texture` carries the layered painting vocabulary the
[`paint` binary](/testing/asset-generation/ui-binaries/#paint--the-layered-raster-painter)
exposes, narrowed to what a material map needs, with two differences. A global
`--map <channel>` selects which map an operation edits instead of a UI element,
and with the case's `[material].tile` set (the default) every operation wraps
toroidally, so the map tiles by construction.

- Layers: `add-layer --name`, `set-blend-mode --layer --mode`, and
  `set-layer-opacity --layer --opacity`.
- Painting: `brush`, `stroke --points "x,y x,y …"`, `fill --color`,
  `bucket --x --y --tolerance`, `fill-rect`, and
  `gradient --type <linear|radial> --stops "0:#…,1:#…" --from x,y --to x,y`.
- Selections: `select-rect`, `select-none`, `invert-selection`, and
  `feather --radius`. While a selection is active every operation is clipped to
  it.
- Filters: `blur --radius`, `sharpen`, `levels --black --white --gamma`,
  `curves --amount`, `hue-sat --hue --sat --lightness`, and `desaturate`.

It adds the procedural generators material authoring relies on, each writing into
the active map:

- `noise --type <perlin|worley|fbm|ridged> --scale --octaves` is the base of most
  natural materials: grain, rust mottle, stone. It is seeded, and it wraps to
  stay tileable.
- `pattern --type <bricks|hex|planks|checker|weave> --scale` stamps regular
  structure: a brick course, deck planking, a mesh weave.
- `warp --source <channel> --amount` displaces the active map by another
  channel's relief, and `gradient-map --stops "0:#…,1:#…"` remaps a grayscale
  field through a color ramp.

```
texture noise --map base-color --type fbm --scale 6 --octaves 4
texture gradient-map --map base-color --stops "0:#3a2f28,0.6:#6b5442,1:#8a7050"
texture pattern --map height --type bricks --scale 4
texture brush --map roughness --brush round-soft --size 48 --x 128 --y 128 \
  --color "#b0b0b0" --scatter 0.4
```

### `pbr` — derivation, uniforms, assembly, and preview

- Bakes: `bake-normal --from height --strength` writes `normal`,
  `bake-ao --from height --radius` writes `ao`, and
  `bake-curvature --from height` writes the `curvature` scratch. A model sculpts
  relief once as grayscale and lets the tool produce the tangent-space normal and
  the occlusion.
- Uniforms: `set-uniform --map <channel> --value <0..1>` fills a scalar map with
  a constant, so a fully-dielectric `metallic 0` or a uniform `roughness 0.6`
  needs no hand-painted flat field.
- Assembly: `assemble --tiling <scale>` writes `material.json` with the
  material's world-space [tiling scale](#the-triplanar-consumption-model). Every
  mutating operation also refreshes `material.json`, so the manifest exists from
  the first operation.
- Preview: `render` draws a lit 3D preview of the material applied to a test
  surface. `--shape <sphere|cube|cylinder|plane>` chooses the surface, `--tiling`
  sets the projection frequency, and `--out` the destination PNG.
  `render --map <channel>` instead writes that one map flat and 2×2-tiled, so
  seams are immediately visible.

```
texture brush --map height --brush round-hard --size 8 --x 64 --y 64 \
  --color "#ffffff" --scatter 1
pbr bake-normal --from height --strength 1.4
pbr bake-ao --from height --radius 6
pbr set-uniform --map metallic --value 1.0
pbr set-uniform --map roughness --value 0.35
pbr render --shape sphere
```

## The triplanar consumption model

A material is applied to a surface by triplanar projection. The surface samples
each map three times, projected down the world X, Y, and Z axes, and blends the
three by the surface normal, so the face most aligned with an axis is weighted
most. The projection needs no UV coordinates, which is why these materials are
authored for it: the [meshed](/testing/asset-generation/mesh-binaries/) surfaces
extracted from a signed-distance field have no natural UV layout, and a tileable
material projects onto them cleanly at a chosen world-space scale. Because the
material tiles seamlessly, the repeats the projection produces are invisible.

This fixes the material's contract:

- Tileable authoring is required for the projection to repeat without seams.
- The base color feeds the surface albedo, the normal perturbs its shading
  normal, roughness and metallic drive the physically-based response, ambient
  occlusion darkens contact shadows, and emissive adds self-illumination.
- The tiling scale in `material.json` sets how large one tile is in world units,
  so the same material reads at a consistent physical scale across
  differently-sized meshes.

The `pbr render` preview applies this projection. It triplanar-samples the base
color, multiplies in ambient occlusion, lifts by emissive, and shades the
resulting per-vertex color under one directional light, so what the model tunes
in the preview is what a surface shows.

## Seed and operation log

`init` records the material's seed as the first log entry, and each operation
that needs randomness derives its own seed from the material seed and its index
in the log. A stochastic operation such as `noise`, a scattered brush, or `warp`
is therefore reproducible from the log without the model supplying a seed. A run
starts pre-seeded: the orchestrator writes an empty operation log and a blank
starting PNG per declared map.

The emitted maps are the authoritative output. A material run is [validated on
the maps it emits](/testing/asset-generation/evaluation/#material-validation)
rather than by replaying its operations, so the emitted maps and `material.json`
are what a reviewer evaluates.

## Preview

`texture` recomposites the edited map after each operation and writes it to
`maps/{map}.png`, which is both the preview the model reads and the emitted map.
Flat 2D compositing is cheap, so it runs on every operation. The `pbr` 3D preview
is the one on-request render, since extracting the test surface and lighting it
is expensive. The orchestrator seeds a `material.config.json` giving the map
size, the declared channels and the tiling flag, the operation-log path, the
`material.json` path, and the `{map}` preview template, so no operation needs
size flags.

## Live preview

When a run is watched, painting streams to the viewer in real time. The
orchestrator adds a `live` block to the seeded config, and after each `texture`
operation the binary streams a one-line JSON header
(`{ token, frame, operation, operationCount, length }`) followed by a 2×2-tiled
PNG of the edited map, so seams show as they appear. A `pbr render` streams the
3D preview the same way. The `frame` field carries the map index, so the viewer
shows the most-recently-edited map and the status of every declared map at once.

Streaming is best-effort: it is absent for an unwatched run, it never fails an
operation, and it is never recorded. The emitted maps remain authoritative.

## The output contract

A material run emits one PNG per declared channel at `maps/{map}.png`, square at
the case's `size` and tileable, plus a single `material.json` carrying:

- `maps` — one entry per emitted channel: its `name`, emitted `path`, and
  `color_space` (`srgb` or `linear`).
- `tiling` — the suggested world-space tile scale for
  [triplanar application](#the-triplanar-consumption-model).
- `size` — the maps' square resolution.

The `height` and `curvature` scratch channels are authoring aids and are not
emitted. The emitted PNGs and `material.json` are produced by the binaries at the
paths core seeds; the manifest declares only the operation log. The
[validator](/testing/asset-generation/evaluation/#material-validation) decodes
each declared map, confirms it is well-formed and the declared `size`, requires
`base-color` to decode, and parses `material.json` for each map's color space and
the tiling scale. A reviewer judges the material per-map, as a 2×2 tiling, and on
the lit `pbr` preview surface, against the brief.
