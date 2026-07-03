---
title: Manifests
---

An asset-generation test case version lives under `test-cases/<slug>/<version>/`
and declares its contents in a `test-case.toml` manifest, the same versioned,
immutable [catalog layout](/testing/end-to-end/overview/#catalog-layout) every
test type uses. Unlike an [end-to-end manifest](/testing/end-to-end/manifests/),
it does not describe a build that produces a static site; it describes the
**canvas** the model draws on, the **drawing tool** it draws with, and where the
recorded **actions** are collected. There is no target image: an
asset-generation case is human-reviewed against its brief, so it declares **no
`[[reference]]`** at all.

```toml
# test-cases/<slug>/<version>/test-case.toml
name = "Imp Sprite"          # human-readable display name (site-facing)
difficulty = "medium"        # relative difficulty: easy | medium | hard (required)
tags = ["asset-generation", "2d", "sprite"] # classification tags (site-facing, required)
summary = "..."              # optional one- or two-sentence abstract for the site cards (inline; NOT seeded)
description = "description.md" # optional site-facing prose (relative path; NOT seeded)
prompt = "prompt.hbs"        # the prompt template handed to the harness (required)
max_runtime_hours = 0.5      # cap on the harness session before it's stopped (default 1)
type = "asset-generation"    # the test type (required for this type; defaults to "end-to-end")
asset_kind = "sprite"        # "sprite" (one sprite, the default) | "sprite-sheet" (per-frame files)
                             # | "voxel-model" | "voxel-animation" (3D — see "Voxel cases" below)

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
different reference (an asset-generation case declares none):

```toml
# test-cases/<slug>/<version>/variants/base.toml
slug = "base"                # stable slug, recorded in the run record
name = "Base"                # display name (optional; default humanizes the slug)
spec = []                    # ADDITIVE specs on top of the common specs (dest defaults to source)
# review_item = [...]        # ADDITIVE reviewer items; may name a common or this variant's own domain
# [[domain]]                 # ADDITIONAL scoring domains, rated only when this variant runs
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
  `"sprite-sheet"` (a set of animation frames, each a separate file),
  `"voxel-model"` (a static 3D voxel model), or `"voxel-animation"` (a rigged,
  animated 3D voxel model). It is a property of the whole version, **not** a
  variant axis — a case is exactly one kind, never a mix, and a variant cannot
  change it. `asset_kind` (and the `[sheet]`, `[voxel]`, and `[model]` tables) are
  only valid for an asset-generation case; an explicit value on any other type is
  rejected. The two 2D kinds declare a `[canvas]`; the two 3D kinds declare a
  `[voxel]` volume instead (see [Voxel cases](#voxel-cases)) — a voxel case must
  **not** declare `[canvas]`, and a 2D case must **not** declare `[voxel]`.
- The `[sheet]` table is **required for — and only for — `asset_kind =
  "sprite-sheet"`**. It declares the case's frames as `[[sheet.frame]]` entries —
  each just the `index` it is written to (passed as
  [`draw-sheet --frame`](/testing/asset-generation/draw-tool/)) — plus one or more
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
  `description`), `prompt`, `max_runtime_hours`, and the `[[spec]]` and `variants`
  seeding rules behave as they do for an
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
  [The drawing binaries](/testing/asset-generation/draw-tool/)). The binary is the
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

## Voxel cases

A **voxel** case (`asset_kind = "voxel-model"` or `"voxel-animation"`) produces a
3D asset instead of a 2D image. It replaces the `[canvas]` table with a `[voxel]`
table and reuses `[tool]` and `[output]` unchanged in shape; an animated case adds
a `[model]` table declaring the [rig](/testing/asset-generation/overview/#the-rig-parts-and-joints).
Everything else on the page — `type`, `variants`, `[[spec]]`, `[[domain]]`,
`[[review_item]]`, the no-`[[reference]]`/no-`[build]`/no-`[[check]]` rules —
behaves exactly as above.

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
# one. `preview` is where the binary rasterizes the isometric PNG after each op.
[tool]
binary  = "voxel"            # the voxel binary in the environment (required)
preview = "model.png"        # where the isometric preview is written (a {part} template for voxel-animation)

# Where the recorded operation log is collected — the authoritative output the
# voxel data and preview are regenerated from.
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

# The REQUIRED rig: the parts, joints, and animations the model must produce. The
# model may add more of its own; this table fixes the stable, game-facing contract
# and the scoring targets. Required for — and only for — asset_kind = "voxel-animation".
[model]

[[model.part]]              # >=1 required; the FIRST is the root (no parent)
name  = "chassis"          # stable part name, unique (targeted with voxel-anim --part chassis)
pivot = [16, 0, 16]        # origin in world voxel coords for the root part

[[model.part]]
name   = "turret"
parent = "chassis"         # a declared part; parents must form a tree (no cycles)
pivot  = [16, 8, 16]       # attachment point in the PARENT's local voxel coords

[[model.part]]
name   = "barrel"
parent = "turret"
pivot  = [16, 10, 20]

[[model.joint]]            # a caller-driven degree of freedom — the game-facing control
name  = "turret_yaw"       # stable joint name; the parameter a game addresses, unique
part  = "turret"           # the part this joint moves (a declared part)
kind  = "rotation"         # "rotation" (radians) | "translation" (voxel units)
axis  = "y"                # "x" | "y" | "z" — acts about (rotation) or along (translation)
pivot = [16, 8, 16]        # joint origin in the part's local voxel coords
min   = -3.14159           # minimum value (radians for rotation, voxels for translation)
max   = 3.14159            # maximum value
rest  = 0.0                # default value, within [min, max]
drive = "caller"           # "caller" (a game supplies the value) | "auto" (an animation drives it)

[[model.joint]]
name   = "barrel_pitch"
part   = "barrel"
kind   = "rotation"
axis   = "x"
pivot  = [16, 10, 20]
min    = -0.2
max    = 0.6
rest   = 0.0
offset = [0.0, 1.0, 0.0]   # optional: a FIXED mount translation (voxels), applied on top of the
                           # driven motion — the translation half of a compound attach. All-zero = none.
orient = [0.2, 0.0, 0.0]   # optional: a FIXED mount rotation (radians, Euler X->Y->Z about pivot) —
                           # the rotation half. A joint with min=max=rest=0 but a non-zero mount is a
                           # purely static attach at a custom rotation AND translation.
drive  = "caller"

# A REQUIRED animation the model must author. The case declares the animation's
# identity and intent — NOT its keyframes: the model authors the motion (the F-curve
# keyframes) with the voxel-anim `define-animation`/`add-keyframe` subcommands, the
# produced rig.json carries it, and the reviewer scores the motion it produced.
[[model.animation]]
name      = "walk"         # stable, unique name (a game plays it by this name)
period_ms = 1200           # one full loop across every track, in milliseconds
loop      = true           # loop (true) or play once and hold the last pose (false)
auto_play = false          # true = plays continuously by default (a decorative idle,
                           # e.g. a radar spin); false = a named playable (walk, recoil)
joints    = ["hip_l", "knee_l", "hip_r", "knee_r"]  # the joints the model MUST drive
```

- The **`[voxel]`** table fixes the bounding volume: its `width`, `height` (up),
  and `depth` in voxels, and the `background` used **only** as the isometric
  preview PNG's clear color — it never places a voxel, because the volume always
  starts **empty**. It is required for — and only for — a voxel case, and replaces
  `[canvas]`: a voxel case declaring `[canvas]`, or a 2D case declaring `[voxel]`,
  is rejected. Voxel cells are **opaque `#rrggbb`** (there is no alpha).
- The **`[tool]`** and **`[output]`** tables work exactly as for a sprite, with the
  voxel binaries: `binary = "voxel"` for a static model, `"voxel-anim"` for an
  animated one (see
  [The voxel binaries](/testing/asset-generation/voxel-binaries/)). For
  `voxel-animation` — where each part is a separate log and preview — `preview` and
  `actions` **must** carry the `{part}` token (as a sheet's carry `{frame}`); for a
  static `voxel-model` they name single files and must **not** carry `{part}`.
- The **`[model]`** table is **required for — and only for — `asset_kind =
  "voxel-animation"`**. It declares the rig's `[[model.part]]` hierarchy,
  `[[model.joint]]` degrees of freedom, and the **required `[[model.animation]]`
  declarations**. Resolution validates that part names are unique, the **first**
  part is the root (no `parent`), every other `parent` names a declared part, the
  parents form a **tree** (no cycles), every joint's `part` names a declared part,
  every joint's `kind`/`axis`/`drive` parse, `min <= rest <= max`, any joint
  `offset`/`orient` mount is finite, and every `[[model.animation]]` has a unique
  `name`, a positive `period_ms`, and `joints` that are all declared joints. A
  joint's optional `offset`/`orient` is a **fixed compound mount** (a translation in
  voxels and a rotation in radians, Euler X→Y→Z about the pivot) applied in addition
  to its driven motion — how a component is attached at a custom rotation *and*
  translation.
- **`[[model.animation]]`** entries declare the **animations the model must
  author** — the timeline motions a game plays (a walk, a recoil, a decorative
  idle) and the reviewer scores. Each declares a unique `name`, a `period_ms`, a
  `loop` flag (loop vs. play once and hold), an `auto_play` flag (whether it plays
  continuously by default — a decorative idle such as a radar spin — versus a named
  playable a game triggers), and the `joints` it must drive. It declares **no
  keyframes**: the model authors the motion as **F-curves** (per-keyframe
  `constant`/`linear`/`bezier` interpolation plus `ease-in`/`ease-out`/`ease-in-out`
  presets — see
  [The voxel binaries](/testing/asset-generation/voxel-binaries/#f-curves)) with the
  `voxel-anim` animation subcommands. The produced animations are carried in
  `rig.json`, exported to glTF for a game to play, and scored against these
  declarations — a missing required animation is a zero-scored contract gap like a
  missing joint.
- **The rig is the *required* contract, not the whole model.** `[model]` fixes the
  parts, joints, and animations the model **must** produce — the stable, game-facing
  interface a consuming game drives and plays, and the targets a reviewer scores. At
  run time the model may **add** further parts, joints, and animations of its own
  with the [`voxel-anim` rig subcommands](/testing/asset-generation/voxel-binaries/);
  the produced `rig.json` carries **everything** (required plus model-added). Its
  **`caller`** joints are the **procedural interface** a game drives per frame
  (turret yaw, gun pitch), exported as machine-readable metadata; its **animations**
  are the baked clips a game plays. The review UI scores against the required set,
  surfaces caller joints as controls, and plays the produced animations; the 3D
  viewer poses the full rig. See
  [Evaluation](/testing/asset-generation/evaluation/).

A voxel-animation `[[review_item]]` may name the caller **joints** it is about (the
analog of a sprite sheet's `sequences`/`frames`), so the review UI surfaces exactly
that joint's viewer and control beside the item.

:::caution[Re-ingest after editing]
The test type and the `[canvas]`/`[voxel]`/`[tool]`/`[output]`/`[model]` tables
are stored in the backend's immutable def store. Because they are newer fields,
editing an
already-ingested case (or adding a type to one) requires a **forced re-ingest**
(`POST /ingest {"force": true}`) — otherwise the backend keeps serving the stale
definition, in which the new fields default empty and the run is treated as
end-to-end. New cases are unaffected.
:::
