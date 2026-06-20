---
title: Manifests
---

An asset-generation test case version lives under `test-cases/<slug>/<version>/`
and declares its contents in a `test-case.toml` manifest, the same versioned,
immutable [catalog layout](/testing/end-to-end/overview/#catalog-layout) every
test type uses. Unlike an [end-to-end manifest](/testing/end-to-end/manifests/),
it does not describe a build that produces a static site; it describes the
**canvas** the model draws on, the **drawing tool** it draws with, where the
recorded **actions** are collected, and the **reference** the regenerated image is
scored against.

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

# The image the model draws on.
[canvas]
width  = 64                  # canvas width in pixels (required)
height = 64                  # canvas height in pixels (required)
background = "transparent"   # initial canvas state: transparent | a hex color

# The drawing tool the model is given. The binary is the only way to make a mark:
# it exposes the operations below, renders the current image after each call so
# the model can read its progress, and records every call it receives.
[tool]
binary     = "draw"                    # the drawing binary available in the environment (required)
operations = "schemas/operations.json" # the brush/mutation operations it exposes (required)
preview    = "canvas.png"              # where the binary writes the current image for the model to read

# Where the recorded operation log is collected and returned to The Test Cabinet.
# This action log — not the pixels on disk — is the authoritative output.
[output]
actions = "actions.json"     # the ordered record of every operation the model issued (required)

# The reference the REGENERATED image is scored against. Same `{ view, media }`
# shape as an end-to-end static reference; the source target is seeded as the
# visual goal handed to the model.
[[reference]]
view  = "target"             # view slug
media = "reference/target.png" # the target image (seeded as the goal; served as-is)

# Variants. As with every test type, a case offers one or more and exactly one
# runs per run. Here a variant varies the BRIEF (an additive spec) the model
# draws toward the case's single shared `target` — a tighter palette, an
# operation budget, a required technique — NOT a different target image (a
# variant may not declare its own reference; see below).
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
  case must declare `[canvas]`, `[tool]`, `[output]`, and exactly one `target`
  reference, and must **not** declare a `[build]` table or any `[[check]]`.
- The site-facing metadata (`name`, `difficulty`, `tags`, `summary`,
  `description`), `prompt`, `max_runtime_seconds`, and the `[[spec]]` /
  `[[variant]]` seeding rules behave as they do for an
  [end-to-end case](/testing/end-to-end/manifests/): the case seeds a brief and a
  target, renders a prompt, and may offer variants. The one difference is
  references: the `target` is a single **common** reference shared by every
  variant, and a variant may **not** declare its own (unlike end-to-end, where a
  variant can add references). So a variant here varies only the seeded brief — an
  additive `[[spec]]` — that the model draws toward that same target. There is
  **no `[build]` table** — an asset-generation run produces a recorded action log,
  not a static site.
- The `[canvas]` table fixes the image the model works on: its `width` and
  `height` in pixels and its initial `background`. Fixing the canvas keeps runs
  comparable, the same way an end-to-end build interface does.
- The `[tool]` table describes the **drawing binary**. `binary` is the executable
  available in the run environment (the `draw` binary, baked into the shared
  run-container image); `operations` is the JSON Schema of the brush/mutation
  operations it accepts, **seeded into the run** (like a spec) so the model can
  read it; `preview` is the path the binary re-renders the current image to after
  each call, so the model can read a real image to see its progress. The binary is
  the **only** channel for drawing — anything produced outside it is discarded
  (see
  [Overview](/testing/asset-generation/overview/#why-the-actions-are-the-output)).
  The seeded `operations` schema is the canonical one the binary emits (`draw
  schema`); keep each case's copy verbatim so it never drifts from the binary.
- The `[output]` table names the `actions` log the binary records and returns.
  This ordered list of operations is the **authoritative output**; The Test
  Cabinet regenerates the scored image from it.
- Each `[[reference]]` names the **target** image the regenerated result is scored
  against. The target is seeded as the visual goal handed to the model, the same
  way an end-to-end case seeds a reference screenshot. A convenient way to author
  one without hand-pixeling is to write the target itself as an action log and
  render it through the same `draw` binary (`draw render --actions … --out
  target.png`), keeping the action log as the un-seeded source; this guarantees
  the target is achievable within the operation set, so fidelity scoring is fair.

:::caution[Re-ingest after editing]
The test type and the `[canvas]`/`[tool]`/`[output]` tables are stored in the
backend's immutable def store. Because they are newer fields, editing an
already-ingested case (or adding a type to one) requires a **forced re-ingest**
(`POST /ingest {"force": true}`) — otherwise the backend keeps serving the stale
definition, in which the new fields default empty and the run is treated as
end-to-end. New cases are unaffected.
:::
