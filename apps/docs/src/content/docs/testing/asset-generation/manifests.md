---
title: Manifests
---

An asset-generation test case version lives under `test-cases/<type>/<difficulty>/<slug>/<version>/`
and declares its contents in a `test-case.toml` manifest, the same versioned,
immutable [catalog layout](/testing/end-to-end/overview/#catalog-layout) every
test type uses. Unlike an [end-to-end manifest](/testing/end-to-end/manifests/),
it does not describe a build that produces a static site; it describes the
**canvas** the model draws on, the **drawing tool** it draws with, and where the
recorded **actions** are collected. There is no target image: an
asset-generation case is human-reviewed against its brief, so it declares **no
`[[reference]]`** at all.

```toml
# test-cases/<type>/<difficulty>/<folder>/<version>/test-case.toml
slug = "imp-sprite"          # stable identity (required); the store key + recorded in every run
name = "Imp Sprite"          # human-readable display name (site-facing)
difficulty = "medium"        # relative difficulty: easy | medium | hard (required)
experimental = false         # optional; true hides the case from the UI unless the deployment enables experimental cases (default false)
tags = ["asset-generation", "2d", "sprite"] # classification tags (site-facing, required)
summary = "..."              # optional one- or two-sentence abstract for the site cards (inline; NOT seeded)
description = "description.md" # optional site-facing prose (relative path; NOT seeded)
changelog = "changelog.md"   # REQUIRED per-version changelog entry (relative path; NOT seeded)
prompt = "prompt.hbs"        # the prompt template handed to the harness (required)
max_runtime_hours = 0.5      # cap on the harness session before it's stopped (default 1)
type = "asset-generation"    # the test type (required for this type; defaults to "end-to-end")
asset_kind = "sprite"        # "sprite" (one sprite, the default) | "sprite-sheet" (per-frame files)
                             # | a high-res painted kind: "ui" (interface art) — see "UI cases"
                             # | "material" (tileable PBR material) — see "Material cases"
                             # | a 3D voxel kind: "voxel-model"/"voxel-animation" (cube cells),
                             # "mc-model"/"mc-animation", "sn-model"/"sn-animation",
                             # "dc-model"/"dc-animation" (meshed) — see "Voxel cases" below
                             # | a skinned character: "mc-skinned"/"sn-skinned"/"dc-skinned"
                             # — see "Skinned cases"
                             # | a Blender-authored skinned character: "blender-character"
                             # — see "Blender character cases"
                             # | a particle effect: "particle-2d"/"particle-3d" — see "Particle cases"
                             # | audio: "sfx-synth"/"sfx-sample"/"music" — see "Audio cases"

# Variants: an ORDERED list of paths to standalone variant files (first = default).
# Because `variants` is a root key, it must appear BEFORE the first table header
# (here `[canvas]`). Each path is relative to the version folder; by convention the
# files live under `variants/`. See the variant-file example below.
variants = ["variants/base.toml"]

# The image the model draws on. For a single sprite this is the whole canvas; for
# a sprite sheet it is ONE frame (every frame is a separate file of this size).
[canvas]
width  = 64                  # canvas width in pixels (required)
height = 64                  # canvas height in pixels (required)
background = "transparent"   # initial canvas state: transparent | a hex color

# The drawing tool the model is given. The binary is the only way to make a mark:
# it renders the current image after each call so the model can read its progress,
# and records every call it receives. There is NO operations schema — the binary's
# `--help` is the contract. Use `draw` for a sprite, `draw-sheet` for a sheet.
[tool]
binary  = "draw"             # the drawing binary available in the environment (required)
preview = "canvas.png"       # where the binary writes the current image to read
                             # (a {frame} template for a sprite sheet, e.g. "frames/{frame}.png")

# Where the recorded operation log is collected and returned to The Test Cabinet.
# This action log — not the pixels on disk — is the authoritative output. A sprite
# sheet records one log per frame, so its path is a {frame} template.
[output]
actions = "actions.json"     # the ordered record of every operation (required)
                             # (a {frame} template for a sprite sheet, e.g. "frames/{frame}.actions.json")

# Only for asset_kind = "sprite-sheet": the frames the model draws (each a separate
# file the size of [canvas]) and the named sequences a reviewer plays back. The
# number of frames is just how many are declared.
[sheet]

[[sheet.frame]]              # >=1 required; one declared frame
index  = 6                   # the index it is written to (draw-sheet --frame 6), unique

[[sheet.frame]]
index  = 7

[[sheet.sequence]]           # >=1 required; one named animation the UI plays back
slug   = "walk-right"        # stable slug (required, unique within the sheet)
name   = "Walk Right"        # display name (optional; default humanizes the slug)
frames = [6, 7]              # ordered frame indices (required, non-empty, each a declared frame)
fps    = 4                   # playback rate in frames per second (required, > 0)

# An asset-generation case declares NO [[reference]]: it is reviewed against its
# brief, with no target image to score the regenerated asset against. (Declaring
# one — common or per-variant — is rejected.)

# Common specs, seeded for EVERY variant (the brief describing what to draw and
# how the tool behaves). Same `source` → `dest` mapping as end-to-end, and `dest`
# likewise defaults to `source` with a trailing `.hbs` removed — so most briefs
# just name the source they seed.
[[spec]]
source = "specs/brief.md"    # dest defaults to "specs/brief.md"

# Common scoring domains, rated for EVERY variant (at least one required); a
# variant may add its own domains in its file.
[[domain]]
id = "fidelity"
name = "Fidelity"
description = "How faithfully the regenerated asset matches the brief." # required
```

Each `variants` entry points at a standalone variant file, exactly as for an
[end-to-end case](/testing/end-to-end/manifests/) — a TOML document whose top-level
keys are the variant's own fields, with every path resolving against the version
folder. Here a variant varies the **brief** (an additive spec) the model draws
toward — a tighter palette, an operation budget, a required technique — **not** a
different reference (an asset-generation case declares none). A **voxel** case's
variant may additionally declare its own **`[voxel]`** volume, overriding the case's
so the same subject is sculpted at a different size (see [Variants vary the volume,
too](#variants-vary-the-volume-too)):

```toml
# test-cases/<type>/<difficulty>/<slug>/<version>/variants/base.toml
slug = "base"                # stable slug, recorded in the run record
name = "Base"                # display name (optional; default humanizes the slug)
spec = []                    # ADDITIVE specs on top of the common specs (dest defaults to source)
# review_item = [...]        # ADDITIVE reviewer items; may name a common or this variant's own domain
# [[domain]]                 # ADDITIONAL scoring domains, rated only when this variant runs
# [voxel]                    # VOXEL cases only: OVERRIDE the case's bounding volume for this variant
```

- `type = "asset-generation"` is the explicit test-type discriminator. It is
  **required** for an asset-generation case; omitting it defaults to
  `"end-to-end"`, which then rejects the `[canvas]`/`[tool]`/`[output]` tables.
  Resolution validates the tables against the declared type: an asset-generation
  case must declare `[canvas]`, `[tool]`, and `[output]`, and must **not** declare
  a `[build]` table, any `[[check]]`, or any `[[reference]]` (it has no target to
  score against — declaring one, common or per-variant, is rejected).
- `asset_kind` chooses the **shape** of the asset within an asset-generation
  case: `"sprite"` (the default — one sprite drawn onto the whole canvas),
  `"sprite-sheet"` (a set of animation frames, each a separate file); the high-res
  painted kinds `"ui"` (an interface asset or kit — see [UI cases](#ui-cases)) and
  `"material"` (a tileable PBR material — see [Material cases](#material-cases)); or
  one of the
  3D **voxel** kinds — the **cube** kinds `"voxel-model"` (static) and
  `"voxel-animation"` (rigged, animated), or the **meshed** kinds `"mc-model"`,
  `"sn-model"`, `"dc-model"` (static) and `"mc-animation"`, `"sn-animation"`,
  `"dc-animation"` (rigged, animated); the **skinned character** kinds
  `"mc-skinned"`, `"sn-skinned"`, `"dc-skinned"` (see [Skinned
  cases](#skinned-cases)); the **particle** kinds `"particle-2d"`, `"particle-3d"`
  (see [Particle cases](#particle-cases)); or the **audio** kinds `"sfx-synth"`,
  `"sfx-sample"`, `"music"` (see [Audio cases](#audio-cases)). It is a property of
  the whole version, **not** a variant axis — a case is exactly one kind, never a
  mix, and a variant cannot change it. `asset_kind` (and the `[sheet]`, `[ui]`,
  `[material]`, `[voxel]`, `[model]`, `[particle]`, and `[audio]` tables) are only
  valid for an asset-generation case; an explicit value on any other type is
  rejected. The two 2D pixel kinds and `ui` declare a `[canvas]` (a `ui` kit adds a
  `[ui]` table of elements); a `material` case declares a `[material]` table; every
  voxel, meshed, and skinned kind declares a `[voxel]` volume instead (see [Voxel
  cases](#voxel-cases)); a particle kind declares a `[particle]` field; and an audio
  kind declares an `[audio]` table — a case declares exactly the one(s) its kind
  requires.
- The `[sheet]` table is **required for — and only for — `asset_kind =
  "sprite-sheet"`**. It declares the case's frames as `[[sheet.frame]]` entries —
  each just the `index` it is written to (passed as
  [`draw-sheet --frame`](/testing/asset-generation/sprite-binaries/)) — plus one or more
  `[[sheet.sequence]]` entries. The number of frames is just how many are declared;
  for a sprite sheet `[canvas]` describes **one frame** (every frame is a separate
  file of that size). Resolution validates that frame indices are unique, and that
  each sequence has a unique non-empty `slug`, at least one `frames` index, every
  index a **declared** frame, and `fps > 0`. Each frame is regenerated
  independently, with no whole-sheet aggregate; the named sequences are surfaced to
  the reviewer and played back as live animations from the per-frame regenerated
  images (the sheet layout travels in the run record so the verdict page can
  animate from the run alone).
- The site-facing metadata (`name`, `difficulty`, `tags`, `summary`,
  `description`), the required `changelog`, `prompt`, `max_runtime_hours`, and the
  `[[spec]]` and `variants` seeding rules behave as they do for an
  [end-to-end case](/testing/end-to-end/manifests/): the case seeds a brief,
  renders a prompt, lists its variants as standalone files (the first the
  default), and each `[[spec]]` `dest` defaults to its `source`. The difference is
  references: an
  asset-generation case declares **none** (unlike end-to-end, where the common set
  and each variant may add reference mockups). So a variant here varies only the
  seeded brief — an additive `[[spec]]` — that the model draws toward. There is
  **no `[build]` table** — an asset-generation run produces a recorded action log,
  not a static site. One rendering difference from end-to-end: a shared **quality
  directive** — the brief is the floor, not the goal; produce the best-looking asset
  you can within its constraints — is prepended to every asset-generation prompt at
  render time (the same wording for every case; it is *not* added for other test
  types), so a case's own `prompt.hbs` stays factual and need not restate it.
- The `[canvas]` table fixes the image the model works on: its `width` and
  `height` in pixels and its initial `background`. For a single sprite this is the
  whole canvas; for a sprite sheet it is one frame. Fixing it keeps runs
  comparable, the same way an end-to-end build interface does.
- The `[tool]` table describes the **drawing binary**. `binary` is the executable
  available in the run environment, baked into the shared run-container image —
  `draw` for a single sprite, `draw-sheet` for a sheet; `preview` is the path the
  binary re-renders the current image to after each call (a `{frame}` template for
  a sheet, one preview per frame), so the model can read a real image to see its
  progress. There is **no operations schema** — the binary's `--help` is the
  contract, and the brief tells the model to read it (see
  [The drawing binaries](/testing/asset-generation/sprite-binaries/)). The binary is the
  **only** channel for drawing — anything produced outside it is discarded (see
  [Overview](/testing/asset-generation/overview/#why-the-actions-are-the-output)).
- The `[output]` table names the `actions` log the binary records and returns (a
  `{frame}` template for a sheet, one log per frame). This ordered list of
  operations is the **authoritative output**; The Test Cabinet regenerates the
  reviewed image from it.
- There are **no targets**. An asset-generation case is judged by a human against
  its [brief](/testing/asset-generation/overview/), so it seeds only the brief
  (and the blank canvas/config the binary writes into) — no goal image, and no
  `[[reference]]`.

## Review items can reference sequences and frames

A sprite-sheet case's `[[review_item]]` entries (the
[reviewer checklist](/testing/end-to-end/manifests/), shared by every test type)
may additionally name the **sheet sequences and frames the item is about**. When
an item names them, the review UI surfaces exactly those animations and frames
beside the item — with a toggle between the live animation and the still frames —
so a reviewer checks the item against the relevant assets without scrolling to the
generated-asset section or hunting for which frame a number refers to.

```toml
[[review_item]]
id     = "four-directions"
title  = "Four readable directions"
text   = "The movement frames read as the creature swimming in four directions…"
sequences = ["walk-down", "walk-up", "walk-left", "walk-right"] # sequence slugs (optional)
frames    = [8, 9]                                              # frame indices (optional)
weight = 3
domain = "fidelity"
```

- `sequences` lists `[[sheet.sequence]]` **slugs**; the animation view plays each
  named sequence. `frames` lists `[[sheet.frame]]` **indices**; the frames view
  shows every referenced frame — the explicit `frames` plus the frames the named
  `sequences` cover.
- Both are **optional**. An item that names neither applies to the asset as a
  whole (the reviewer uses the full generated-asset section). An item that names
  only `frames` shows just those frames (there is nothing to animate).
- Resolution validates that every slug names a declared sequence and every index a
  declared frame. Both are valid **only** for a sprite-sheet case (`asset_kind =
  "sprite-sheet"`): a single sprite, or any non-asset case, has no sheet, so
  declaring either is rejected.

## UI cases

A **`ui`** case produces a [high-resolution interface
asset](/testing/asset-generation/overview/#user-interface-assets) — one image or a
**kit** of named elements — painted with the
[`paint` and `ui` binaries](/testing/asset-generation/ui-binaries/). It reuses
`[canvas]` for the base element size and adds an **optional `[ui]`** table declaring
the kit's elements; omit `[ui]` for a single full-canvas image. Everything else on
the page — `type`, `variants`, `[[spec]]`, `[[domain]]`, `[[review_item]]`, the
no-`[[reference]]`/no-`[build]`/no-`[[check]]` rules — behaves exactly as above.

```toml
asset_kind = "ui"

# The base element size (and single-image size) and initial background — the same
# [canvas] table a sprite uses.
[canvas]
width  = 512
height = 512
background = "transparent"

# The drawing tools. `binary` names the PRIMARY tool (`paint`); the companion `ui`
# binary (vector shapes, text, nine-slice) ships in the SAME run-container image and
# is on PATH — the brief directs the model to both. `preview` is a {element} template
# for a kit, a single file for a single-image case.
[tool]
binary  = "paint"
preview = "elements/{element}.png"   # or "canvas.png" for a single-element case

# The recorded op log — a SINGLE interleaved record for the whole asset (each op
# carries --element). Core emits the flattened per-element PNG(s) and ui.json
# automatically (not manifest-declared).
[output]
actions = "actions.json"

# OPTIONAL: a KIT of named elements (omit for a single full-canvas image). Each
# element is its own document of its own size — the interface analogue of a sheet's
# frames.
[ui]

[[ui.element]]                 # >=1 when [ui] is present; a declared element
name   = "panel"               # stable, unique name (draw with --element panel)
width  = 512                   # element width in pixels (required)
height = 320                   # element height in pixels (required)
nine_slice = { left = 24, right = 24, top = 24, bottom = 24 }  # OPTIONAL fixed insets

[[ui.element]]
name   = "button-primary"
width  = 256
height = 72
```

- The **`[ui]`** table is **optional** and valid only for `asset_kind = "ui"`. When
  present it declares one or more `[[ui.element]]` entries — each a `name` (unique)
  and its `width`/`height`; a `nine_slice` (`left`/`right`/`top`/`bottom`) may fix
  the stretchable insets, otherwise the model authors them with
  [`ui set-nine-slice`](/testing/asset-generation/ui-binaries/#ui--crisp-shapes-text-and-nine-slice).
  When `[ui]` is **absent**, the case has a single implicit element (the whole
  `[canvas]`). Resolution validates that element names are unique and that any fixed
  `nine_slice` insets fit within the element's bounds.
- `[tool].binary` names the primary painter (`paint`); the companion `ui` binary is
  baked into the same `ui` image and available on `PATH`. `[tool].preview` carries
  the `{element}` token when `[ui]` declares elements, and is a single file
  otherwise (as a sheet's `preview` carries `{frame}`). `[output].actions` is a
  **single** interleaved op log — **not** an `{element}` template — since the two
  binaries share one recorded stream. The emitted per-element PNGs and the `ui.json`
  (element sizes, nine-slice insets, atlas rectangles) are produced automatically by
  core, so they are not manifest-declared (see [the output
  contract](/testing/asset-generation/ui-binaries/#the-output-contract)).

## Material cases

A **`material`** case produces a [tileable PBR
material](/testing/asset-generation/overview/#pbr-materials) — a set of maps
(base color, and any of normal, roughness, metallic, ambient occlusion, emissive) —
painted with the [`texture` and `pbr`
binaries](/testing/asset-generation/material-binaries/). It replaces
`[canvas]`/`[voxel]` with a **`[material]`** table and declares no `[model]` — a
material is judged subjectively against its brief, with no required-animation
contract, and a case authors **one material** (as a single sprite is one image).

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

# The tools. `binary` names the PRIMARY painter (`texture`); the companion `pbr`
# binary (bake normal/AO, uniforms, assemble, 3D preview) ships in the SAME image and
# is on PATH. `preview` is a {map} template — one preview per map, shown 2×2-tiled.
[tool]
binary  = "texture"
preview = "maps/{map}.png"

# The recorded op log — a SINGLE interleaved record (each op carries --map). Core
# emits the per-map PNGs and material.json automatically (not manifest-declared).
[output]
actions = "actions.json"
```

- The **`[material]`** table fixes the material's output: its square `size` (a power
  of two), whether it is authored `tile`able (seamless — the default, required for
  [triplanar application](/testing/asset-generation/material-binaries/#the-triplanar-consumption-model)),
  and the `maps` it emits. `maps` must include **`base-color`** and is otherwise any
  subset of `normal`, `roughness`, `metallic`, `ao`, `emissive`. (The `height`
  channel a case bakes relief from is an authoring aid, not an emitted map, so it is
  not declared here.) It is required for — and only for — a material case, and
  replaces `[canvas]`/`[voxel]`.
- `[tool].binary` names the primary painter (`texture`); the companion `pbr` binary
  is baked into the same `material` image and on `PATH`. `[tool].preview` carries the
  `{map}` token (one preview per declared map); `[output].actions` is a **single**
  interleaved op log — **not** a `{map}` template — since the two binaries share one
  recorded stream. Core emits one PNG per declared map (`maps/{map}.png`) plus the
  `material.json` (paths, per-map color space, and the world-space tiling scale)
  automatically; neither is manifest-declared (see [the output
  contract](/testing/asset-generation/material-binaries/#the-output-contract)).

## Voxel cases

A **voxel** case produces a 3D asset instead of a 2D image. There are eight voxel
kinds in two families: the **cube** kinds (`asset_kind = "voxel-model"` or
`"voxel-animation"`), which sculpt discrete opaque cells, and the **meshed** kinds
(`"mc-model"`/`"mc-animation"`, `"sn-model"`/`"sn-animation"`,
`"dc-model"`/`"dc-animation"`), which extract a surface from a signed-distance field
(see [Meshed voxel models](/testing/asset-generation/overview/#meshed-voxel-models)).
Every voxel kind replaces the `[canvas]` table with a `[voxel]` table and reuses
`[tool]` and `[output]` unchanged in shape; every **animated** kind (any
`-animation`) adds a `[model]` table declaring the
[required animations](/testing/asset-generation/overview/#the-rig-parts-and-joints)
the model must author (the rig's parts and joints are the model's to invent).
Everything else
on the page — `type`, `variants`, `[[spec]]`, `[[domain]]`, `[[review_item]]`, the
no-`[[reference]]`/no-`[build]`/no-`[[check]]` rules — behaves exactly as above.

```toml
# A static voxel model (asset_kind = "voxel-model").
asset_kind = "voxel-model"

# The bounding volume the model sculpts into — the 3D analog of [canvas]. Cells
# are OPAQUE #rrggbb (no alpha) and the volume starts EMPTY.
[voxel]
width      = 32              # extent along x, in voxels (required)
height     = 32              # extent along y — up — in voxels (required)
depth      = 32              # extent along z, in voxels (required)
background = "transparent"   # PNG preview clear color only: transparent | a hex color
                             # (it never places a voxel; the volume is always empty to start)

# The building binary. `voxel` for a static model, `voxel-anim` for an animated
# one. `preview` is where the binary writes the wgpu PNG preview when the model runs
# `render` (voxel rendering is on request, not after every op).
[tool]
binary  = "voxel"            # the voxel binary in the environment (required)
preview = "model.png"        # where the preview PNG is written (a {part} template for voxel-animation)

# Where the recorded operation log is collected. A cube case names its op log here;
# a meshed case names its emitted mesh instead (see below).
[output]
actions = "actions.json"     # the ordered op record (a {part} template for voxel-animation)
```

For an **animated** case, `[tool].preview` and `[output].actions` become
`{part}` templates (one preview and one log per part, e.g.
`parts/{part}.png` and `parts/{part}.actions.json`), and the case adds a
`[model]` table:

```toml
# A rigged, animated voxel model (asset_kind = "voxel-animation").
asset_kind = "voxel-animation"

[voxel]
width = 32
height = 24
depth = 32
background = "transparent"

[tool]
binary  = "voxel-anim"      # required for voxel-animation
preview = "parts/{part}.png"   # {part} REQUIRED for voxel-animation

[output]
actions = "parts/{part}.actions.json"  # {part} REQUIRED for voxel-animation

# The REQUIRED rig contract — and the ONLY thing the case fixes about the rig: the
# set of animations the model must author. A case declares NO parts and NO joints —
# the model INVENTS whatever skeleton the subject needs (parts, joints, pivots,
# ranges) at run time and is scored on whether it worked out the right pieces and
# animated them. [model] holds ONLY [[model.animation]] entries. Required for — and
# only for — asset_kind = "voxel-animation".
[model]

# A REQUIRED animation the model must author, declared by IDENTITY ALONE — its name
# and whether it loops / self-plays. The case fixes NO parts, joints, period, or
# keyframes: the model invents the rig it needs and authors the motion (the F-curve
# keyframes, and the period) at run time with the voxel-anim
# `define-animation`/`add-keyframe` subcommands, the produced rig.json carries it, and
# the reviewer scores the motion it produced against the brief.
[[model.animation]]
name      = "walk"         # stable, unique name a game plays this animation by (required)
loop      = true           # loop (true, the default) or play once and hold the last pose (false)
auto_play = false          # false (default) = a named playable a game triggers (walk, recoil);
                           # true = plays continuously on its own (a decorative idle, e.g. a radar spin)
```

A **meshed** case (`asset_kind` beginning `mc-`, `sn-`, or `dc-`) is identical in
manifest shape to a cube case — it frames the same `[voxel]` volume, and its
animated kinds carry the same `[model]` rig — but its `[tool].binary` is the
corresponding **meshing binary**. Its `[output]` names the **op log** the binary
records — exactly like a cube case — while the extracted **`.glb`** (binary glTF)
triangle geometry the surface extractor produces is emitted to a path core provides
automatically (it is not declared in the manifest):

```toml
# A static meshed model (asset_kind = "dc-model"; mc-model / sn-model are identical
# in shape — only the binary differs).
asset_kind = "dc-model"

[voxel]
width  = 48                  # the field bounds — the same volume table as a cube case,
height = 48                  # here framing the signed-distance field the surface is
depth  = 48                  # extracted from (see "Meshed voxel models")
background = "transparent"

[tool]
binary  = "dc"               # the meshing binary: mc | sn | dc (static),
                             # mc-anim | sn-anim | dc-anim (animated)
preview = "model.png"        # where the wgpu preview PNG is written (a {part} template for an animated kind)

[output]
actions = "actions.json"     # the recorded op log (as for a cube case); the extracted
                             # .glb geometry is emitted automatically by core
```

An **animated** meshed case (`mc-animation`, `sn-animation`, `dc-animation`) uses the
`-anim` binary and, exactly like `voxel-animation`, makes `[tool].preview` and
`[output].actions` `{part}` templates and adds the `[model]` rig table:

```toml
# A rigged, animated meshed model (asset_kind = "sn-animation").
asset_kind = "sn-animation"

[voxel]
width = 40
height = 32
depth = 40
background = "transparent"

[tool]
binary  = "sn-anim"          # required for sn-animation (mc-anim / dc-anim for the others)
preview = "parts/{part}.png"    # {part} REQUIRED for an animated kind

[output]
actions = "parts/{part}.actions.json" # {part} REQUIRED for an animated kind

# The REQUIRED rig contract — the required animations, declared EXACTLY as for
# voxel-animation (the [[model.animation]] entries above; NO parts or joints — the
# model invents those at run time). Required for — and only for — an animated kind.
[model]
```

- The **`[voxel]`** table fixes the bounding volume: its `width`, `height` (up),
  and `depth` in voxels, and the `background` used **only** as the preview PNG's
  clear color — it never places material, because the volume always starts
  **empty**. For a cube case it bounds the sculpted cells; for a meshed case it
  frames the signed-distance field the surface is extracted from. It is required
  for — and only for — a voxel case, and replaces `[canvas]`: a voxel case declaring
  `[canvas]`, or a 2D case declaring `[voxel]`, is rejected. Voxel material is
  **opaque `#rrggbb`** (there is no alpha). The volume is the case's **default**: a
  **variant may declare its own `[voxel]`** to override it (see [Variants vary the
  volume, too](#variants-vary-the-volume-too)), so the same subject can be sculpted
  at more than one size.
- The **`[tool]`** and **`[output]`** tables work exactly as for a sprite, with the
  voxel binaries. `[tool].binary` is the binary for the kind: `voxel` / `voxel-anim`
  for the cube kinds, and `mc` / `sn` / `dc` (static) or `mc-anim` / `sn-anim` /
  `dc-anim` (animated) for the meshed kinds (see
  [The voxel binaries](/testing/asset-generation/voxel-binaries/)). Which binary a
  case names fixes the output's **character** — a cube volume, or an `mc` low-poly,
  `sn` smooth, or `dc` sharp-edged surface — it is **not** a manifest knob. Every
  voxel case's `[output]` names its `actions` op log; for a meshed case core also
  emits the extracted geometry automatically (`mesh.glb`, or `meshes/{part}.glb`
  per part for an animated kind), so it is not manifest-declared. For an **animated** kind — where each part is
  authored, previewed, and emitted separately — `preview` and the `[output]` path
  **must** carry the `{part}` token (as a sheet's carry `{frame}`); for a **static**
  kind they name single files and must **not** carry `{part}`.
- The **`[model]`** table is **required for — and only for — an animated voxel
  kind** (`voxel-animation` or any meshed `-animation`: `mc-animation`,
  `sn-animation`, `dc-animation`). It declares **only** the case's **required
  `[[model.animation]]` declarations** — the set of animations the model must
  author. It declares **no parts and no joints**: the rig's parts, joints, pivots,
  and ranges are **model-invented at run time** (with the
  [`define-part` / `define-joint` subcommands](/testing/asset-generation/voxel-binaries/#rig-subcommands)),
  never fixed by the case. Resolution validates only that every `[[model.animation]]`
  has a unique `name`; there is nothing else on the table to validate.
- **`[[model.animation]]`** entries declare the **animations the model must
  author** — the timeline motions a game plays (a walk, a recoil, a decorative
  idle) and the reviewer scores. Each declares just its **identity**: a unique
  `name`, a `loop` flag (loop vs. play once and hold, default `true`), and an
  `auto_play` flag (default `false`; whether it plays continuously on its own — a
  decorative idle such as a radar spin — versus a named playable a game triggers).
  It fixes **no parts, joints, period, or keyframes**: the model invents whatever
  rig realizes the animation and authors the motion as **F-curves** (per-keyframe
  `constant`/`linear`/`bezier` interpolation plus `ease-in`/`ease-out`/`ease-in-out`
  presets — see
  [The voxel binaries](/testing/asset-generation/voxel-binaries/#f-curves)),
  choosing the period, with the `voxel-anim` animation subcommands. The produced
  animations are carried in `rig.json`, exported to glTF for a game to play, and
  **reconciled** against these declarations — a required animation that is missing,
  or that never actually animates, is a contract gap.
- **The required animations are the contract; the rig is the model's to invent.**
  `[model]` fixes **only** the animations the model **must** produce — a case says
  WHAT the thing is and HOW it must move, never the pieces that move. Every part,
  joint, and pivot is **model-invented at run time** with the
  [`voxel-anim` rig subcommands](/testing/asset-generation/voxel-binaries/); the
  produced `rig.json` carries the whole rig the model built. A rig's **`caller`**
  joints are the **procedural interface** a game drives per frame (turret yaw, gun
  pitch), exported as machine-readable metadata; its **animations** are the baked
  clips a game plays. The review UI reconciles the produced animations against the
  required set, surfaces caller joints as controls, and plays the produced
  animations; the 3D viewer poses the full rig. See
  [Evaluation](/testing/asset-generation/evaluation/).

### Variants vary the volume, too

For a voxel case the bounding volume is a **variant axis**: a variant may declare
its **own `[voxel]` table**, which **replaces** the case's `[voxel]` for runs of
that variant (like a variant's `workspace`, it overrides rather than layers). A
variant with no `[voxel]` inherits the case's volume. This is how a case offers the
**same subject at several sizes** — the idiomatic set is a `base` variant (no
override, so it inherits the case volume), a `half` variant, and a `double` variant,
each with its own `[voxel]`:

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

Resolution validates a variant's `[voxel]` exactly as the case's — every extent
`> 0`, the `background` parses — and **rejects** a `[voxel]` on a variant of any
**non-voxel** case (only a voxel case has a volume to vary). The size a variant runs
at flows to everything that reads the volume: the tool config the binary is seeded
with, the volume the produced model is scored against, and the brief.

So a voxel brief should **not** hardcode its dimensions. Its `[[spec]]` is written as
a Handlebars template (a `.hbs` source; the seeded `dest` drops the `.hbs`), and the
[spec-template context](/testing/end-to-end/overview/#spec-templates) exposes the
effective volume as `{{voxel}}`: `{{voxel.width}}`/`{{voxel.height}}`/`{{voxel.depth}}`
for the extents and `{{voxel.maxX}}`/`{{voxel.maxY}}`/`{{voxel.maxZ}}` for the highest
index on each axis (so an inclusive coordinate range reads `` `0`–`{{voxel.maxX}}` ``).
The same `{{voxel}}` context is available in the case's `prompt.hbs`. One brief then
reads correctly at every size. (Because coordinates are size-dependent, a voxel case's
`[[review_item]]` and `[[domain]]` text should describe the form **without** citing
specific coordinates or exact extents — a reviewer judges the shape, not numbers.)

## Skinned cases

A **skinned** case (`asset_kind = "mc-skinned"`, `"sn-skinned"`, or `"dc-skinned"`)
produces a [character](/testing/asset-generation/overview/#skinned-character-models):
a single continuous skin bound to a model-invented skeleton, deforming across its
joints. Its manifest is a **meshed animated** case with one difference — the model
builds **one whole-body field**, not a field per part — so its `[tool].preview` and
`[output].actions` are **single files** (not `{part}` templates), even though it is
an animated kind carrying a `[model]` table:

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
actions = "actions.json"     # a SINGLE op log — NOT a {part} template; the skinned
                             # mesh.glb + rig.json are emitted automatically by core

# The REQUIRED animations, declared EXACTLY as for voxel-animation — by identity
# alone. The skeleton, its bones, joints, and per-vertex binding are all
# model-invented at run time; the case fixes only the animations.
[model]

[[model.animation]]
name      = "walk"
loop      = true
auto_play = false
```

- A skinned case declares a **`[voxel]`** volume (the field bounds), like a meshed
  case, and a **`[model]`** table of required animations, like any animated kind —
  the skeleton, joints, and weights are the model's to invent. Because it builds a
  single field, `[tool].preview` and `[output].actions` are **single files** and
  must **not** carry `{part}` — this is the one animated kind that does not. Core
  emits the skinned **`mesh.glb`** (geometry plus the glTF skin — per-vertex bone
  weights and inverse-bind matrices) and **`rig.json`** (the skeleton, the joint
  interface, and the F-curve animations) automatically; neither is manifest-declared.
  See [The skinned binaries](/testing/asset-generation/skinned-binaries/).

## Blender character cases

A **`blender-character`** case produces a rigged, animated [skinned
character](/testing/asset-generation/blender-binaries/) — like the CSG
[skinned kinds](#skinned-cases), but authored by driving **headless Blender** through its
Python API instead of a constrained op-log tool. The model writes a **`build.py`** (a
`bpy` script) that builds the character mesh, an armature it invents, the skin weights,
an empty `weapon_socket` bone, and one Action per required animation, then runs the
**`tcab-blend`** runner to export a single **`character.glb`** (a standard skinned +
animated glTF 2.0) and a `model.png` preview. The emitted glTF is the authoritative,
judged output; there is **no operation log** — `build.py` **is** the recorded authoring
trace, re-run for provenance. It reuses `[voxel]` as a **bounding box** and `[model]` for
its required animations.

```toml
asset_kind = "blender-character"

# The character's BOUNDING BOX — the volume the whole character must fit within, in world
# units (width x, height y-up, depth z; forward is +z). This is the [voxel] table reused
# as a bounds box (a Blender character is a real mesh, not a voxel field); `background` is
# the preview clear color only. A blender-character case must NOT declare [canvas].
[voxel]
width  = 24
height = 48
depth  = 20
background = "transparent"

# The authoring tool. `tcab-blend` runs the model's `build.py` under headless Blender
# (`blender --background --python build.py -- blender.config.json`), exports the glTF, and
# renders the preview. `preview` is a SINGLE file (one mesh — no `{part}` token).
[tool]
binary  = "tcab-blend"
preview = "model.png"

# The authored `build.py` IS the recorded output/trace — NOT an op log. The validator
# re-runs it for provenance. The emitted skinned `character.glb` is produced by the runner
# and is NOT manifest-declared (core provides its path).
[output]
actions = "build.py"

# The required animations, declared EXACTLY as for the skinned/voxel-animation kinds — by
# identity alone. The skeleton, weapon socket, and weights are the model's to invent.
[model]

[[model.animation]]
name      = "idle"
loop      = true
auto_play = true

[[model.animation]]
name      = "run"
loop      = true
auto_play = false

# The self-contained brief, plus the `build.py` STARTER STUB seeded to the workspace root
# (the path `[output].actions` names) so the model edits it in place.
[[spec]]
source = "specs/brief.md"

[[spec]]
source = "specs/build.py"
dest   = "build.py"
kind   = "script"          # tag it "Script" (not "Spec") on the Inputs tab
```

- The **`[voxel]`** table is the character's **bounding box** (not a voxel field): its
  `width`/`height`/`depth` in world units and a `background` used only as the preview
  clear color. It replaces `[canvas]`. Like a voxel case it is a **variant axis** — a
  variant may declare its own `[voxel]` to author the same character at another size.
- **`[tool].binary` is `tcab-blend`** and **`[output].actions` is the authored `build.py`**
  — the recorded trace, re-run for provenance, **not** an operation log. Both are single
  files and must **not** carry a `{part}` token. Because `build.py` is authored by the
  model from a **seeded starter stub**, the stub is seeded as the case's own **`[[spec]]`**
  with `dest = "build.py"` (landing at the run root), and it is the **one case** where a
  spec `dest` deliberately coincides with `[output].actions`. That spec sets
  **`kind = "script"`** so the run's **Inputs** tab tags the starter `Script` rather than
  `Spec` — a presentation-only marker that does not change how the file is seeded (see the
  [end-to-end `[[spec]]` reference](/testing/end-to-end/manifests/)).
- **`[model]` fixes only the required animations** (each a unique `name`, a `loop` flag,
  and an `auto_play` flag), exactly as for the [skinned cases](#skinned-cases). The
  skeleton, the `weapon_socket` bone, the per-vertex weights, and the keyframes are all
  **model-invented** in `build.py`.
- **`character.glb` and `model.png` are runner-emitted, not declared.** The skinned,
  animated glTF (`character.glb`) and the preview (`model.png`) are produced by
  `tcab-blend`, never named in the manifest.
- **No `[[reference]]`, no `[build]`, no `[[check]]`.** Judged on the emitted glTF plus a
  reviewer's judgment. There is **no cheat-divergence check** (that is only for the
  `draw`/`draw-sheet` sprite kinds); instead the validator **re-runs `build.py`** and
  records any divergence from the emitted glTF — the Blender analogue, recorded not gated
  (see [Blender validation](/testing/asset-generation/evaluation/#blender-validation)).
- The orchestrator seeds a **`blender.config.json`** (the bounding box, the axes, the
  output paths, and the required animation names) the runner and `build.py` read.

## Particle cases

A **particle** case (`asset_kind = "particle-2d"` or `"particle-3d"`) produces a
[particle effect](/testing/asset-generation/overview/#particle-effects): the model
authors an emitter system the review UI and a game **simulate live**. It replaces
`[canvas]`/`[voxel]` with a **`[particle]`** table and declares no `[model]` — a
particle effect is judged subjectively against its brief, with no required-animation
contract, and a case authors **one effect** (as a single sprite is one image).

```toml
# A 3D particle effect (asset_kind = "particle-3d").
asset_kind = "particle-3d"

# The field the effect plays in and how it is baked. A particle-2d case gives
# width/height only (a 2D field, like [canvas]); particle-3d adds depth (a volume,
# like [voxel]).
[particle]
width       = 48             # extent along x (required)
height      = 48             # extent along y — up (required)
depth       = 48             # extent along z (required for particle-3d; omitted for particle-2d)
duration_ms = 1500           # the effect's length in milliseconds (required)
fps         = 60             # the preview/playback frame rate (required, > 0)
loop        = false          # one-shot (an explosion, default) or looping (fire, smoke)
background  = "transparent"  # preview clear color only

[tool]
binary  = "particle-3d"      # the particle binary: particle-2d | particle-3d
preview = "effect.gif"       # where the binary writes the preview animation

[output]
actions = "actions.json"     # the recorded op record; the emitted system.json is
                             # emitted automatically by core
```

- The **`[particle]`** table fixes the field the effect plays in — `width`/`height`
  (and, for `particle-3d`, `depth`), its `duration_ms` and playback `fps`, and
  whether the effect `loop`s — and, like every other kind, a `background` used only
  as the preview's clear color. It is required for — and only for — a particle case,
  and replaces `[canvas]`/`[voxel]`. There is no simulation seed: a particle effect
  is **simulated live** (not baked), so it varies slightly from one play to the next,
  exactly as a real particle editor plays a system.
- Core emits the authored **`system.json`** (the emitter/force/curve definition the
  review UI and a game **simulate live**) automatically; it is not manifest-declared.
  See [The particle binaries](/testing/asset-generation/particle-binaries/).

## Audio cases

An **audio** case (`asset_kind = "sfx-synth"`, `"sfx-sample"`, or `"music"`) produces
a short [audio clip](/testing/asset-generation/overview/#audio). It replaces
`[canvas]`/`[voxel]` with an **`[audio]`** table, declares no `[model]` (a clip is
judged subjectively against its brief), and authors **one clip** per case.

```toml
# A sample-library sound effect (asset_kind = "sfx-sample").
asset_kind = "sfx-sample"

[audio]
sample_rate     = 44100      # output sample rate in Hz (required)
channels        = "stereo"   # "mono" | "stereo" (required)
max_duration_ms = 5000       # cap on the rendered clip's length in ms (required, positive)
sample_pack     = "naval-weapons@1"  # for sfx-sample: the baked sample pack (name@version)
                             # instrument_bank = "orchestral@1"  # for music: the baked instrument bank

[tool]
binary  = "sfx-sample"       # the audio binary: sfx-synth | sfx-sample | music
preview = "waveform.png"     # where the binary writes the waveform + spectrogram
                             # (a piano-roll as well, for music)

[output]
actions = "actions.json"     # the recorded op record; the rendered clip.wav (and, for
                             # music, the portable clip.mid) are emitted automatically
```

- The **`[audio]`** table fixes the output format: its `sample_rate`, `channels`,
  and `max_duration_ms` (any positive clip-length cap). A **`sfx-sample`** case additionally names
  the **`sample_pack`** it mixes over, and a **`music`** case names the
  **`instrument_bank`** it plays — each a `name@version` identifying the palette
  **baked into the run-container image**, never a path in this repo (see [the sample
  library](/testing/asset-generation/audio-binaries/#the-sample-library)). A
  `sfx-synth` case names neither — it synthesizes from oscillators alone.
- Core emits the rendered **`clip.wav`** (and, for `music`, a portable **`clip.mid`**
  score) automatically; neither is manifest-declared. Because the asset is a finished
  waveform, an audio case has **no** produced rig or system a runtime plays — the
  clip is simply played. See [The audio binaries](/testing/asset-generation/audio-binaries/).

:::caution[Re-ingest after editing]
The test type and the
`[canvas]`/`[ui]`/`[material]`/`[voxel]`/`[tool]`/`[output]`/`[model]`/`[particle]`/`[audio]`
tables are stored in the backend's immutable def store. Because they are newer fields,
editing an
already-ingested case (or adding a type to one) requires a **forced re-ingest**
(`POST /ingest {"force": true}`) — otherwise the backend keeps serving the stale
definition, in which the new fields default empty and the run is treated as
end-to-end. New cases are unaffected.
:::
