# Caldera Basalt — `v1.0.0`

This is version `v1.0.0` of the **Caldera Basalt** test case: an
asset-generation case (`asset_kind = "material"`) that asks a model to author a
tileable, seamless PBR material of weathered volcanic basalt using only the
`texture` and `pbr` tools, one recorded operation at a time. The brief calls for
near-black cooled lava cut by a hairline network of ashen, faintly glowing
fissures, with mineral crust, grit, and vesicle pitting.

`caldera-basalt` is the catalog slug for this case. The material dresses the
terraced hex terrain of the `caldera` tower-defense case, the cliff walls and
terrace floors of a volcanic bowl, applied by triplanar projection, which is why
it must tile seamlessly. There is no target image: the model authors the
material toward the seeded brief and is reviewed subjectively against it.

## The tools: `texture` and `pbr`

A material run has two binaries on its `PATH`, both baked into the single
`material` run-container image:

- `texture` — the seamless raster map painter. It edits one map at a time,
  selected with `--map` on every op. Brushes, gradients, the procedural
  generators (`noise`, `pattern`, `warp`, `gradient-map`), and filters all wrap
  across the map edges, so a map tiles without a seam by construction.
- `pbr` — the derivation and assembly tool. It bakes the `normal` and `ao` maps
  from a painted grayscale `height` field, sets uniform scalar maps, assembles
  `material.json`, and renders the lit 3D preview of the material on a test
  surface, applied by the same triplanar projection the terrain uses.

The height-to-normal/AO bake workflow is the heart of the case: the model
sculpts the relief once as grayscale `height` and bakes the coherent relief maps
from it rather than hand-painting an RGB normal. The binaries' `--help` is the
contract; no operations schema is seeded.

## The maps

The `[material]` table declares a 1024×1024 material that emits four maps:
`base-color` (required, sRGB albedo), `normal` (baked relief), `roughness`
(glassy fissures against matte crust), and `ao` (baked occlusion). There is no
`metallic`, since basalt is a dielectric, and no `emissive`, since the faint
ember is a warm tint in the base-color. The `height` channel the relief maps are
baked from is an authoring aid rather than an emitted map, so it is not listed
in `maps`.

Unlike a `draw` sprite, a material run is not regenerated from its op log. The
authoritative output is the maps the tools emit (`maps/{map}.png` per channel
plus `material.json`), produced automatically by core and not
manifest-declared. The op log is recorded for the run record and the live
preview only, so a material case has no cheat-divergence check.

## Contents

| Path             | Seeded to run? | Purpose                                                |
| ---------------- | -------------- | ------------------------------------------------------ |
| `specs/brief.md` | Yes            | The self-contained material brief.                     |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.          |
| `test-case.toml` | No             | Manifest: material maps, tools, op-log output, review. |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).      |
| `description.md` | No             | Site blurb.                                            |
| `README.md`      | No             | This overview.                                         |

A run receives the seeded brief, the `texture` and `pbr` binaries, and a seeded
`material.config.json` the orchestrator writes, holding the map size, the
declared channels and tiling, the store and op-log paths, and the `{map}`
preview template, so no operation needs size flags. There is no target material
and no operations schema: the binaries' `--help` is the contract, and the
emitted maps plus `material.json` are the authoritative output.

## Variants

Caldera Basalt ships a single default variant, `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's
single `overall` scoring domain; it adds no specs or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/caldera-basalt/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version
folders.
