---
title: Material binaries
description: The seamless map painter (`texture`) and the PBR derivation/assembly tool (`pbr`) a "material" asset-generation case builds a tileable PBR material with, the triplanar consumption model, and the per-map PNG + material.json output contract.
---

A **material** asset-generation run (`asset_kind = "material"`) produces a
**tileable PBR material** — the set of maps that dresses a 3D surface: a base color,
a normal map for surface relief, and the scalar maps (roughness, metallic, ambient
occlusion, emissive) a physically-based shader reads. It is the kind that lets a
[meshed model](/testing/asset-generation/mesh-binaries/) read as painted metal,
worn stone, or scuffed hull plating rather than a flat `#rrggbb`. A run builds it
through **two binaries** on its `PATH`, both baked into the single **`material`
run-container image**:

- **`texture`** — a **seamless raster map painter**: the same layered painting
  vocabulary the [`paint` binary](/testing/asset-generation/ui-binaries/) exposes,
  restricted to **one square map at a time** and made **tileable** — brushes,
  gradients, and filters **wrap across the map's edges**, so a stroke that runs off
  the right continues on the left and the map tiles without a seam. It also adds the
  procedural generators material work leans on (noise, patterns, warps).
- **`pbr`** — the **derivation and assembly** tool: it **bakes** a normal map (and
  ambient occlusion and curvature) from a painted **height** map, sets **uniform**
  scalar maps, assembles the **`material.json`** that binds the maps together, and
  renders a **lit 3D preview** of the material applied to a test surface so the model
  sees how it reads on geometry, not just as flat swatches.

Both are built from `crates/paint` (the shared raster engine) and `crates/voxel-mesh`
(the preview surface and its lighting), and share one operation log and one config.

## A material is a set of maps

The case's [`[material]`](/testing/asset-generation/manifests/#material-cases) table
declares the map **channels** the material carries. Every material has a
**base-color** channel; a case may also declare any of:

| Channel | What it encodes | Color space |
| --- | --- | --- |
| `base-color` | the surface albedo (required) | **sRGB** |
| `normal` | tangent-space surface relief (RGB-encoded normal) | linear |
| `roughness` | microfacet roughness, 0 = mirror … 1 = matte | linear |
| `metallic` | dielectric (0) vs. metal (1) | linear |
| `ao` | baked ambient occlusion | linear |
| `emissive` | self-illumination color | **sRGB** |
| `height` | a scratch relief field the `pbr` bakes `normal`/`ao`/curvature from | linear |

Each channel is an independent square map of the case's `size`, edited as its own
layered document and selected with a global `--map <channel>` on every operation
(default `base-color`). `height` is an **authoring aid**: a model paints relief into
it and bakes the normal/AO from it, rather than hand-painting a normal map — it is
not required to be one of the emitted maps.

Color space matters for correctness and is recorded in `material.json`: `base-color`
and `emissive` are **sRGB** (color data), while `normal`, `roughness`, `metallic`,
`ao`, and `height` are **linear** (data, not color). The tools tag each map
accordingly so a consumer samples it right.

## The operations are ordinary CLI subcommands

Neither binary seeds an operations schema; each binary's `--help` is the contract,
exactly as with every other asset tool, and the brief tells the model to read it:

```
texture --help               # every map-painting operation
texture noise --help
pbr --help                   # bake, uniform, assemble, render
pbr bake-normal --help
```

### `texture` — seamless map painting

`texture` exposes the **full raster vocabulary** of the
[`paint` binary](/testing/asset-generation/ui-binaries/#paint--the-layered-raster-painter)
— layers and blend modes, brushes and strokes, gradients, selections and masks,
filters, transforms — so it is not re-documented here; author a map exactly as you
paint a UI layer, with two differences:

- **`--map <channel>`** selects which map an operation edits (`base-color`,
  `roughness`, `height`, …) instead of a UI element. Every operation carries it.
- **Everything is seamless.** With the case's `[material].tile` set (the default),
  every brush, gradient, filter, and pattern **wraps toroidally** across the map's
  edges, so the map tiles without a seam by construction — there is no separate
  "make seamless" pass to run.

It adds the procedural generators material authoring relies on, each writing into the
active map:

- **`noise --type <perlin|worley|fbm|ridged> --scale --octaves`** — the base of most
  natural materials (grain, rust mottle, stone). Seeded (see [Seed and operation
  log](#seed-and-operation-log)); it wraps to stay tileable.
- **`pattern --type <bricks|hex|planks|checker|weave> --scale`** — regular
  structure (a brick course, deck planking, a mesh weave).
- **`warp --map <source> --amount`** and **`gradient-map --stops`** — distort a map
  by another (for organic variation) and remap a grayscale field to a color ramp.

```
texture noise --map base-color --type fbm --scale 6 --octaves 4
texture gradient-map --map base-color --stops "0:#3a2f28,0.6:#6b5442,1:#8a7050"
texture pattern --map height --type bricks --scale 4
texture brush --map roughness --brush round-soft --size 48 --color "#b0b0b0" --scatter 0.4
```

### `pbr` — derivation, uniforms, assembly, and preview

- **Bakes** — `bake-normal --from height --strength`, `bake-ao --from height
  --radius`, and `bake-curvature --from height` derive the relief maps from a painted
  `height` field, so a model sculpts relief once as grayscale and lets the tool
  produce the tangent-space normal and occlusion. `bake-normal` writes the `normal`
  map; `bake-ao` writes (or multiplies into) `ao`.
- **Uniforms** — `set-uniform --map <channel> --value <0..1>` fills a scalar map with
  a constant (a fully-dielectric `metallic 0`, a uniform `roughness 0.6`) without
  hand-painting a flat field.
- **Assembly** — `assemble` writes **`material.json`** (also run automatically when
  the run finishes): the manifest of which maps are present, their emitted paths,
  each map's color space, and the material's suggested **tiling scale** (the
  world-space size one tile covers) for [triplanar
  application](#the-triplanar-consumption-model).
- **Preview** — `render` draws a **lit 3D preview** of the assembled material applied
  to a test surface, so the model reads how the maps combine on geometry.
  `render --shape <sphere|cube|cylinder|plane>` chooses the surface and `render --map
  <channel>` inspects one map flat. The preview uses the shared **`wgpu` renderer
  targeting Mesa lavapipe** (software Vulkan, headless, CPU-only) the
  [voxel family](/testing/asset-generation/mesh-binaries/#preview-rendering-wgpu--mesa-lavapipe)
  uses, applying the maps by **triplanar projection** — the same way a mesh consumes
  the material — so the preview reads apples-to-apples with the finished surface.

```
texture brush --map height --brush round-hard --size 8 --color "#ffffff" --scatter 1
pbr bake-normal --from height --strength 1.4
pbr bake-ao --from height --radius 6
pbr set-uniform --map metallic --value 1.0
pbr set-uniform --map roughness --value 0.35
pbr render --shape sphere
```

## The triplanar consumption model

A material is applied to a surface by **triplanar projection**: the surface samples
each map **three times** — projected down the world **X**, **Y**, and **Z** axes —
and blends the three by the surface normal, so the face most aligned with an axis is
weighted most. This needs **no UV coordinates**, which is exactly why it is the model
these materials are authored for: the [meshed](/testing/asset-generation/mesh-binaries/)
surfaces extracted from a signed-distance field have no natural UV layout to unwrap,
but a **tileable** material projects onto them cleanly at a chosen world-space scale.
Because a material tiles seamlessly, the repeats a projection produces are invisible.

This is what fixes the material's contract:

- **Tileable** authoring (every map wraps) is not a nicety — it is required for the
  projection to repeat without seams.
- The **base color** feeds the surface albedo; the **normal** perturbs its shading
  normal; **roughness**/**metallic** drive the physically-based response;
  **ambient occlusion** darkens contact shadows; **emissive** adds self-illumination.
- The **tiling scale** in `material.json` sets how large one tile is in world units,
  so the same material reads at a consistent physical scale across differently-sized
  meshes.

The `pbr render` preview applies exactly this projection, so what the model tunes in
the preview is what a surface shows.

## Seed and operation log

`init` records the material's **seed** as the first log entry, and per-operation
seeds are derived from it (a PRNG seeded at `init`, one seed per operation by index),
so any stochastic operation — `noise`, a scattered brush, `warp` — is reproducible
from the log without the model supplying a seed. The **emitted maps are the
authoritative output**; the operation log is recorded for the run record and the
[live preview](#live-preview), not to regenerate the material for scoring. A material
run is [validated on the maps it emits](/testing/asset-generation/evaluation/#material-validation),
not by replaying its operations, and there is **no cheat-divergence check** — the
emitted maps and `material.json` are what a reviewer evaluates, however produced.

## Preview

`texture` **re-renders the active map's preview after each operation** — a flat map
is cheap 2D compositing — and renders it as a **2×2 tiling** so seams (or their
absence) are immediately visible, the defining feedback of texture work. The `pbr`
**3D material preview** is the one **on-request** render (extracting the test surface
and lighting it is expensive, as with the voxel tools), run when the model wants to
see the maps combined on geometry. The orchestrator seeds a `material.config.json`
giving the map size, the `[material]` channels and tiling, the layer-store and
op-log paths, and the `{map}` preview template, so no operation needs size flags.

## Live preview

When a run is being **watched**, painting is streamed to the viewer in real time, as
with the [UI](/testing/asset-generation/ui-binaries/#live-preview) and
[voxel](/testing/asset-generation/mesh-binaries/#live-preview) tools: the
orchestrator adds a `live` block to the config, and after each `texture` operation
(and each `pbr render`) the binary streams a one-line JSON header followed by the
freshly rendered preview PNG's bytes. The `frame` field carries the **map index**,
so the viewer shows the most-recently-edited map and the status of every declared
map at once. Streaming is best-effort and non-essential — absent for an unwatched
run, never fails an operation, never recorded; the emitted maps remain authoritative.

## The output contract

A material run emits, **per declared channel**, a **PNG** at `maps/{map}.png` — the
case's `size`, tileable, tagged with its color space — plus a single **`material.json`**:

- **`maps`** — one entry per emitted channel: its name, path, and color space
  (sRGB / linear).
- **`tiling`** — the suggested world-space tile scale for
  [triplanar application](#the-triplanar-consumption-model).
- **`size`** — the maps' square resolution.

The `height` channel, being an authoring aid, is **not** emitted; the maps a consumer
reads (`base-color`, `normal`, `roughness`, `metallic`, `ao`, `emissive`) are. The
emitted PNGs and `material.json` are produced automatically by core — **not**
manifest-declared (the manifest declares only the
[`actions`](/testing/asset-generation/manifests/#material-cases) log). The
[validator](/testing/asset-generation/evaluation/#material-validation) decodes each
map, confirms it is well-formed, the declared `size`, and tileable, that `base-color`
is present and non-empty, and that `material.json` is well-formed; a reviewer judges
the material — shown per-map, as a 2×2 tiling, and on the lit `pbr` preview surface —
against the brief.
