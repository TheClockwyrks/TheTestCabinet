---
title: Overview
---

An asset-generation test case version lives under
`test-cases/<type>/<difficulty>/<slug>/<version>/` and declares its contents in a
`test-case.toml` manifest, the same versioned, immutable
[catalog layout](/testing/end-to-end/overview/#catalog-layout) every test type
uses. The manifest describes what the model authors into, the tool it authors
with, and where the recorded operation log is collected. It declares no
`[[reference]]`: an asset-generation case is human-reviewed against its brief,
with no target to score against.

```toml
# test-cases/<type>/<difficulty>/<folder>/<version>/test-case.toml
slug = "imp-sprite"          # stable identity (required); recorded in every run
name = "Imp Sprite"          # human-readable display name (site-facing)
difficulty = "medium"        # relative difficulty: easy | medium | hard (required)
experimental = false         # optional; true hides the case unless the deployment
                             # enables experimental cases
tags = ["asset-generation", "2d", "sprite"] # classification tags (site-facing, required)
summary = "..."              # optional abstract for the site cards (inline; NOT seeded)
description = "description.md" # optional site-facing prose (relative path; NOT seeded)
changelog = "changelog.md"   # REQUIRED per-version changelog entry (relative path; NOT seeded)
prompt = "prompt.hbs"        # the prompt template handed to the harness (required)
max_runtime_hours = 0.5      # cap on the session and on each setup step (default 1)
type = "asset-generation"    # the test type (required for this type; defaults to "end-to-end")
asset_kind = "sprite"        # the shape of asset the model produces (default "sprite")

# Variants: an ORDERED list of paths to standalone variant files (first = default).
# Because `variants` is a root key, it must appear BEFORE the first table header.
variants = ["variants/base.toml"]

# The tables the kind itself requires. A sprite case declares `[canvas]`; every
# other kind declares its own, listed under "Choosing an asset kind" below.
[canvas]
width  = 64                  # canvas width in pixels (required, > 0)
height = 64                  # canvas height in pixels (required, > 0)
background = "transparent"   # initial state: transparent (the default) | a hex color

# The authoring tool. The binary records every call it receives; its `--help` is the
# contract, and no operations schema is seeded.
[tool]
binary  = "draw"             # the binary available in the run environment (required)
preview = "canvas.png"       # where the binary writes the preview the model reads

# Where the recorded operation log is collected and returned to The Test Cabinet.
[output]
actions = "actions.json"     # the ordered record of every operation (required)

# Common specs, seeded for EVERY variant (the brief describing what to produce and
# how the tool behaves). Same `source` -> `dest` mapping as end-to-end, and `dest`
# likewise defaults to `source` with a trailing `.hbs` removed.
[[spec]]
source = "specs/brief.md"    # dest defaults to "specs/brief.md"

# The single scoring domain every asset-generation case declares.
[[domain]]
id = "overall"
name = "Overall"
description = "How good the produced asset is overall, judged against the brief." # required
```

## The type discriminator

`type = "asset-generation"` is required. Omitting it defaults the case to
`"end-to-end"`, which then rejects the `[tool]` and `[output]` tables. Resolution
validates the declared tables against the type. An asset-generation case must
declare `[tool]` and `[output]`, and must declare no `[build]` table, no
`[[check]]`, and no `[[reference]]`, common or per-variant. A `reference` on a
`[[review_item]]` is likewise rejected, because there is no target to show as
expected.

`asset_kind` and the `[sheet]`, `[ui]`, `[material]`, `[voxel]`, `[model]`, and
`[particle]` tables are valid only for an asset-generation case. An explicit
value on any other type is rejected. The `[audio]` table is also accepted on a
[full-stack](/testing/full-stack/manifests/) or
[game-jam](/testing/game-jam/manifests/) case, where it declares only the audio
packs a run may reach.

## Choosing an asset kind

`asset_kind` fixes the shape of the asset. It is a property of the whole version
rather than a variant axis: a case is exactly one kind, and a variant cannot
change it. Each kind declares exactly the tables its family requires.

| `asset_kind`                                                      | Required tables                   | Page                                                                  |
| ----------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------- |
| `sprite`, `sprite-sheet`                                          | `[canvas]`; `[sheet]` for a sheet | [Sprite cases](/testing/asset-generation/manifests/sprite-cases/)     |
| `ui`                                                              | `[canvas]`, optional `[ui]`       | [UI cases](/testing/asset-generation/manifests/ui-cases/)             |
| `material`                                                        | `[material]`                      | [Material cases](/testing/asset-generation/manifests/material-cases/) |
| `voxel-model`, `mc-model`, `sn-model`, `dc-model`                 | `[voxel]`                         | [Voxel cases](/testing/asset-generation/manifests/voxel-cases/)       |
| `voxel-animation`, `mc-animation`, `sn-animation`, `dc-animation` | `[voxel]`, `[model]`              | [Voxel cases](/testing/asset-generation/manifests/voxel-cases/)       |
| `mc-skinned`, `sn-skinned`, `dc-skinned`                          | `[voxel]`, `[model]`              | [Skinned cases](/testing/asset-generation/manifests/skinned-cases/)   |
| `blender-character`, `blender-mechanism`                          | `[voxel]`, `[model]`              | [Blender cases](/testing/asset-generation/manifests/blender-cases/)   |
| `blender-prop`                                                    | `[voxel]`                         | [Blender cases](/testing/asset-generation/manifests/blender-cases/)   |
| `particle-2d`, `particle-3d`                                      | `[particle]`                      | [Particle cases](/testing/asset-generation/manifests/particle-cases/) |
| `sfx-synth`, `sfx-sample`, `music`                                | `[audio]`                         | [Audio cases](/testing/asset-generation/manifests/audio-cases/)       |

## The tool and output tables

`[tool].binary` names the executable the model authors with. Each `asset_kind`
runs in its own container image, built from the shared base image plus that
kind's binaries, so the binary a case names must be the one its kind provides.
The three Blender kinds are the exception: they share one image.
The choice of binary fixes the character of the output, such as a cube volume
against an `mc` low-poly or `dc` sharp-edged surface, and is not a per-case knob
beyond the choice of kind.

`[tool].preview` is the path the binary writes the preview image to. It carries a
token for the kinds that author more than one document at a time: `{frame}` for a
sprite sheet, `{element}` for a `ui` kit, `{map}` for a material, and `{part}` for
a per-part animated kind. A kind that authors a single document names a single
file and must omit the token.

`[output].actions` names the recorded operation log. A sprite sheet and a
per-part animated kind record one log per frame or part, so their paths are
templates. Every other kind records a single interleaved log. Emitted artifacts
such as `ui.json`, `material.json`, `mesh.glb`, `rig.json`, `system.json`, and
`clip.wav` are written to paths core provides and are never declared in the
manifest.

## Specs, variants, and the prompt

The site-facing metadata, the required `changelog`, `prompt`,
`max_runtime_hours`, and the `[[spec]]` and `variants` seeding rules behave as
they do for an [end-to-end case](/testing/end-to-end/manifests/). Each `variants`
entry points at a standalone variant file whose top-level keys are the variant's
own fields, with every path resolving against the version folder:

```toml
# test-cases/<type>/<difficulty>/<slug>/<version>/variants/base.toml
slug = "base"                # stable slug, recorded in the run record
name = "Base"                # display name (optional; default humanizes the slug)
spec = []                    # ADDITIVE specs on top of the common specs
```

A variant varies the brief the model authors toward through an additive
`[[spec]]`: a tighter palette, an operation budget, a required technique. A case
with a `[voxel]` volume may additionally vary that volume per variant, described
under [Voxel cases](/testing/asset-generation/manifests/voxel-cases/).

A shared quality directive is prepended to every asset-generation prompt at
render time. It states that the brief is the floor rather than the goal and asks
for the best asset the model can produce within the brief's constraints. The
wording is the same for every case and is added for no other test type, so a
case's own `prompt.hbs` stays factual.

## Reference implementations

`reference_implementation` is an optional per-variant key, declared in a variant
file exactly as it is for an
[end-to-end case](/testing/end-to-end/manifests/). It names a directory, by
convention `reference-impl/<variant>/`, holding a `draw.sh`: a script of nothing
but calls to the case's own authoring binary, producing the authored correct
asset the same one-operation-at-a-time way a model must.

Running the script reproduces both the images and the action logs, so neither is
committed. The script is the single source of truth. It runs against a workspace
seeded from the manifest, the same seeding a run gets, so it must not write the
tool's config file, must not run the binary's `init` command, and must not
restate the declared canvas size or frames. A script that disagrees with its case
fails against the seeded config.

A reference implementation is never seeded into a run. It is published
out-of-band by
[`tcab publish-reference`](/components/cli/overview/#commands), which runs the
script and uploads the frames and logs it produced, and appears on the case
page's Reference tab. It is unrelated to `[[reference]]`, which an
asset-generation case never declares.

Render a reference locally while authoring one:

```sh
node scripts/preview-asset-reference.mjs <slug>
# or point it straight at a script you are iterating on:
node scripts/preview-asset-reference.mjs path/to/reference-impl/<variant>/draw.sh
```

It seeds a workspace from the manifest exactly as a publish does, runs the
script, and writes the per-frame images, the action logs, and one animated GIF
per declared sequence to `tmp/asset-previews/<slug>/<variant>/`. Open the
`index.html` it writes to see everything at once. The GIFs use the same encoder
and settings as the console's download button.

## Judged on one overall rating

An asset-generation case declares no reviewer checklist: no `[[review_item]]` on
the case and none on any variant. Whether a sprite reads as the creature the
brief describes, whether a walk cycle has weight, whether a material sits right
under light are judgments about the asset as a whole.

The whole review is one rating, so every asset-generation case declares the same
single scoring domain:

```toml
[[domain]]
id = "overall"
name = "Overall"
description = "How good the produced asset is overall, judged against the brief."
```

The reviewer takes in the produced asset, reads the brief, and gives it one
[rating](/components/core/results/#reviews). A run's overall rating is the worst
across its domains, and there is exactly one, so that rating is the run's rating.
The run's point score is empty for these cases.

That puts the weight on the brief. Every requirement a checklist item would have
named must be stated there, since the brief is both what the model is asked to
satisfy and what the reviewer rates it against.

:::caution[Re-ingest after editing]
The test type and the
`[canvas]`/`[ui]`/`[material]`/`[voxel]`/`[tool]`/`[output]`/`[model]`/`[particle]`/`[audio]`
tables are stored in the backend's immutable def store. Editing an
already-ingested case, or adding a type to one, requires a forced re-ingest
(`POST /ingest {"force": true}`). Without it the backend keeps serving the stale
definition, in which the new fields default empty and the run is treated as
end-to-end. New cases are unaffected.
:::
