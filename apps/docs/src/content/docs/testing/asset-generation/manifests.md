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
max_runtime_seconds = 1800   # cap on the harness session before it's stopped (default 3600)
type = "asset-generation"    # the test type (required for this type; defaults to "end-to-end")
asset_kind = "sprite"        # "sprite" (one sprite, the default) | "sprite-sheet" (per-frame files)

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

# Variants. As with every test type, a case offers one or more and exactly one
# runs per run. Here a variant varies the BRIEF (an additive spec) the model
# draws toward — a tighter palette, an operation budget, a required technique —
# NOT a different reference (a variant declares no reference; see below).
[[variant]]
slug = "base"                # stable slug, recorded in the run record
name = "Base"                # display name (optional; default humanizes the slug)
spec = []                    # ADDITIVE specs on top of the common specs

# Common specs, seeded for EVERY variant (the brief describing what to draw and
# how the tool behaves). Same `source` → `dest` mapping as end-to-end.
[[spec]]
source = "specs/brief.hbs"
dest   = "specs/brief.md"
```

- `type = "asset-generation"` is the explicit test-type discriminator. It is
  **required** for an asset-generation case; omitting it defaults to
  `"end-to-end"`, which then rejects the `[canvas]`/`[tool]`/`[output]` tables.
  Resolution validates the tables against the declared type: an asset-generation
  case must declare `[canvas]`, `[tool]`, and `[output]`, and must **not** declare
  a `[build]` table, any `[[check]]`, or any `[[reference]]` (it has no target to
  score against — declaring one, common or per-variant, is rejected).
- `asset_kind` chooses the **shape** of the asset within an asset-generation
  case: `"sprite"` (the default — one sprite drawn onto the whole canvas) or
  `"sprite-sheet"` (a set of animation frames, each a separate file). It is a
  property of the whole version, **not** a variant axis — a case is either a single
  sprite or a sprite sheet, never both, and a variant cannot change it. `asset_kind`
  (and the `[sheet]` table) are only valid for an asset-generation case; an
  explicit value on any other type is rejected.
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
  `description`), `prompt`, `max_runtime_seconds`, and the `[[spec]]` /
  `[[variant]]` seeding rules behave as they do for an
  [end-to-end case](/testing/end-to-end/manifests/): the case seeds a brief,
  renders a prompt, and may offer variants. The difference is references: an
  asset-generation case declares **none** (unlike end-to-end, where the common set
  and each variant may add reference mockups). So a variant here varies only the
  seeded brief — an additive `[[spec]]` — that the model draws toward. There is
  **no `[build]` table** — an asset-generation run produces a recorded action log,
  not a static site.
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

:::caution[Re-ingest after editing]
The test type and the `[canvas]`/`[tool]`/`[output]` tables are stored in the
backend's immutable def store. Because they are newer fields, editing an
already-ingested case (or adding a type to one) requires a **forced re-ingest**
(`POST /ingest {"force": true}`) — otherwise the backend keeps serving the stale
definition, in which the new fields default empty and the run is treated as
end-to-end. New cases are unaffected.
:::
