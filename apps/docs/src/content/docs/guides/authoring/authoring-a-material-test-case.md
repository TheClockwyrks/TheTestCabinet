---
title: Authoring a Material Test Case
---

## Overview

A material [asset-generation](/testing/asset-generation/overview/#pbr-materials)
test case (`asset_kind = "material"`) asks a model to author a tileable PBR
material to match a written brief: the set of maps that dresses a 3D surface so
it reads as painted metal, worn stone, or scuffed hull plating. There is no
target image. The model is given a precise description and authors a material
that matches it.

Read [Material cases](/testing/asset-generation/manifests/material-cases/) for
the authoritative manifest schema and
[The material binaries](/testing/asset-generation/material-binaries/) for the
`texture` and `pbr` tools, the height bake workflow, and the triplanar
consumption model a material is authored for. The worked example is
`caldera-basalt`, a weathered volcanic-basalt material under
`test-cases/asset-generation/medium/caldera-basalt/`.

## Case layout

A material case produces one material: a set of square maps painted seamlessly,
plus a `material.json` binding them together. A version lives under
`test-cases/<type>/<difficulty>/<slug>/<version>/` and is immutable once a run
references it. Revise by adding a new version.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, material, tool, output, domain
  variants/              # one standalone TOML file per variant, listed in `variants`
  prompt.hbs             # rendered per run into the model's instruction (NOT seeded)
  description.md         # site-facing prose (NOT seeded)
  changelog.md           # required per-version changelog entry (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/brief.md         # the brief (SEEDED)
```

A run receives the selected variant's specs, the `texture` and `pbr` binaries
whose `--help` is the operations contract, a seeded `material.config.json`
carrying the map size, the declared channels and tiling, and the log, preview,
and `material.json` paths, and one blank preview PNG per declared map. No
operations schema is seeded.

The authoritative output is the maps the tools emit: one PNG per declared
channel plus `material.json`, both produced by core. The operation log is
recorded for the run record and the live preview.

## Procedure

### 1. Choose the surface

Pick a catalog slug for the lineage and the surface to author. A material case
is about a tileable surface rather than an object: weathered volcanic basalt,
riveted iron deck plating, mossy granite. A good subject:

- reads as a repeating surface, with consistent grain and mesoscale detail such
  as a brick course, a rust mottle, or a stone crack network, rather than a
  single focal feature that betrays the tiling repeat;
- reads at the declared tiling scale. Decide up front roughly how large one tile
  is in world units and choose detail that stays legible at that scale;
- exercises the maps you declare. A normal map needs relief worth baking, a
  roughness map needs wet-versus-dry or polished-versus-worn contrast, and a
  metallic map needs metal-versus-dielectric regions.

Pick a `version` (`vX.Y.Z`).

### 2. Write the brief

Write `specs/brief.md` as a single self-contained file. A material brief pins
down more than a sprite brief, because the material is a set of maps and each
one means something specific. Cover:

- the surface: what it is, its mesoscale structure, and how uniform or varied it
  reads across a tile. State that it must tile seamlessly, and give the tiling
  scale in real terms, such as one tile covering roughly a two-metre span, so
  the model knows how coarse to work and a reviewer knows how to judge the
  repeat;
- the exact palette, as named colors with hex values, stated as the palette the
  base-color and any emissive work within;
- which maps to emit and what each encodes:
  - `base-color` (required, sRGB) is the albedo, carrying no baked lighting or
    shadow;
  - `normal` (linear) is the surface relief, authored by painting a grayscale
    `height` field and baking the normal from it;
  - `roughness` (linear, 0 mirror to 1 matte) is where the surface is glassy
    versus matte. Give the intended range;
  - `ao` (linear) is baked ambient occlusion darkening the recesses, also baked
    from the `height` field.
- that `height` is an authoring aid rather than an output. The model paints
  relief into `height` and bakes `normal` and `ao` from it; `height` is never
  listed in `[material].maps`;
- how the tools behave: that `texture` is the only way to paint a map and that
  everything wraps seamlessly, so a stroke off one edge continues on the
  opposite edge; that `pbr` bakes the relief maps, sets uniform scalar maps,
  assembles `material.json`, and renders the lit 3D preview; and that the
  emitted maps are the output. Point the model at each tool's `--help` for the
  exact operations.

State only the channels you emit. Naming a channel the surface gives nothing to
fill wastes the model's effort.

The brief must stand on its own with no link outside the seeded set, and every
visual detail written in real terms: concrete hexes, an explicit roughness
range, a stated tile scale.

#### The working path through the tools

Fold a short, factual section into the brief so the model knows the intended
path rather than reverse-engineering it from `--help`:

- Every `texture` operation carries `--map <channel>` and defaults to
  `base-color`. Each channel is its own layered document of the case's `size`.
- Build the body with the procedural generators: `noise` for grain and mottle,
  `pattern` for regular structure, `warp` to distort one map by another, and
  `gradient-map` to remap a grayscale field to a color ramp. Each writes into
  the active map and wraps to stay tileable.
- Sculpt relief once, in `height`, then derive the rest: `pbr bake-normal`
  writes the `normal` map, `pbr bake-ao` writes the `ao` map, and
  `pbr bake-curvature` is available for edge wear. Baking from one height field
  keeps the normal, AO, and any curvature-driven color coherent.
- Fill flat scalar maps with `pbr set-uniform`, then paint variation on top in
  `texture` only where it belongs.
- `pbr assemble --tiling` writes `material.json` with the material's world-space
  tiling scale. Every mutating operation refreshes it too, so the manifest
  exists from the first operation.
- `pbr render` draws the lit 3D preview of the material on a test surface under
  the same triplanar projection a mesh uses, so the model should render
  periodically to judge how the maps combine on geometry.
  `pbr render --map <channel>` instead writes that one map flat and 2x2 tiled,
  so seams are immediately visible. `texture` recomposites the edited map after
  every operation, which is both the model's preview and the emitted map.

### 3. Write `prompt.hbs`

A short instruction pointing the model at the seeded brief, telling it to read
`texture --help`, `pbr --help`, and the per-subcommand help, and stating the
hard requirements: author only through the two tools, paint every map
seamlessly, emit exactly the declared maps, and return when finished. The
template renders in strict mode, so use only the documented variables:
`{{variant.slug}}`, `{{variant.name}}`, `{{variant.description}}`,
`{{time_limit_hours}}`, `{{workspace}}`, and `{{#each specs}}`. A shared quality
directive is prepended to every asset-generation prompt at render time, so keep
the prompt factual.

### 4. Write the manifest

Author `test-case.toml` per
[Material cases](/testing/asset-generation/manifests/material-cases/). The
tables specific to this kind:

```toml
type = "asset-generation"    # required; omitting it defaults to end-to-end
asset_kind = "material"

variants = ["variants/base.toml"]

# Replaces [canvas]/[voxel]; a material case declares no [model].
[material]
size = 1024                  # square map resolution, a power of two
tile = true                  # seamless authoring, required for triplanar application
maps = ["base-color", "normal", "roughness", "ao"]
background = "transparent"   # preview clear color only

# `binary` names the PRIMARY painter; `pbr` ships in the same image and is on PATH.
[tool]
binary  = "texture"
preview = "maps/{map}.png"   # one preview per declared map

# One interleaved log; each op carries its own --map.
[output]
actions = "actions.json"

[[spec]]
source = "specs/brief.md"

[[domain]]
id = "overall"
name = "Overall"
description = "How good the produced asset is overall, judged against the brief."
```

Points to get right:

- `maps` must include `base-color` and is otherwise any subset of `normal`,
  `roughness`, `metallic`, `ao`, and `emissive`. `height` is never listed.
- `[output].actions` is a single log rather than a `{map}` template, because the
  two binaries share one recorded stream.
- Core emits the per-map PNGs and `material.json` to paths it provides, so
  neither is manifest-declared.
- A material case declares no `[model]`, no `[[reference]]`, no `[build]`, and
  no `[[check]]`.
- The single `overall` `[[domain]]` is the whole review. The material is judged
  as a whole against its brief, so the case declares no `[[review_item]]` on
  itself or on a variant. See
  [Judged on one overall rating](/testing/asset-generation/manifests/overview/#judged-on-one-overall-rating).
- A variant varies only the seeded brief through an additive `[[spec]]`.

### 5. Write the non-seeded docs

`description.md` (site blurb), `changelog.md` (the required per-version entry),
and `README.md` (human overview). These never reach a run.

## Validate your work

Resolve and seed the case. For every variant:

```sh
tcab prompt --test-case caldera-basalt --version v1.0.0 --variant base
tcab seed   --test-case caldera-basalt --version v1.0.0 --variant base
```

`prompt` renders the instruction, catching strict-mode template errors and
manifest problems including a missing `type`, a `[material]` without
`base-color`, and a `size` that is not a power of two. `seed` writes the seeded
repository to disk so you can read exactly what the model would receive and
confirm it is self-contained. Lint the specs with `npm run lint:specs`, then
exercise the case end to end with
[Run a Test Case](/quickstarts/development/run-a-test-case/) and read the
emitted maps, `material.json`, and the `pbr` preview.

Editing an already-ingested case needs a forced re-ingest, because the backend's
def store is immutable per case version:

```sh
scripts/reingest.sh --force caldera-basalt
```

## Next steps

- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/)
  assesses a run of your case, judging the material per map, as a 2x2 tiling,
  and on the lit preview surface.
