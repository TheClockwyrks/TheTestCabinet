---
title: Manifests
---

Each end-to-end test case version declares its contents in a `test-case.toml`
manifest in the version folder. The testing harness reads this manifest to
resolve the version and to decide, unambiguously, what is seeded into a run,
which references are rendered as visual targets, and which validation checks run.
Inferring this from file names alone would be fragile, so it is stated
explicitly. For the meaning of the pieces it declares, see
[Overview](/testing/end-to-end/overview/).

```toml
# test-cases/<slug>/<version>/test-case.toml
name = "Carom"               # human-readable display name (site-facing)
difficulty = "medium"        # relative difficulty: easy | medium | hard (required)
tags = ["arcade", "2d"]      # free-form classification tags (site-facing, required)
summary = "..."              # optional one- or two-sentence abstract for the site cards (inline; NOT seeded)
description = "description.md" # optional site-facing prose (relative path; NOT seeded)
prompt = "prompt.hbs"        # the prompt template handed to the harness (required)
max_runtime_seconds = 1800   # cap on the harness session before it's stopped (default 3600)
workspace = "workspaces/base" # optional starter directory; its files seed the run root before the specs
init = "npm install"         # optional command run in the container after seeding, before the harness
assets = []                  # asset files/directories, seeded (relative paths)

# How validation builds the produced implementation into a served static site.
# Required: a case must state both commands explicitly; there are no defaults.
[build]
install = "npm ci"           # dependency install command (required)
build = "npm run build"      # static-build command (required)

# Common specs, seeded for EVERY variant. Each maps a `source` inside the
# version folder to a `dest` in the run's workspace. A `.hbs` source is rendered
# (see Spec templates); any other source is seeded verbatim.
[[spec]]
source = "specs/overview.hbs" # source path (relative to this folder); .hbs = rendered
dest   = "specs/overview.md"  # destination in the run workspace (relative)

# Variants. A case offers one or more; exactly one runs per run. Each seeds the
# common specs above plus its own additional specs, and may declare its own
# variant-specific references on top of the common ones.
[[variant]]
slug = "base"                # stable slug, recorded in the run record
name = "Base"                # display name (optional; default humanizes the slug)
description = "..."          # optional inline prose (site-facing)
spec = []                    # ADDITIVE specs on top of the common specs
workspace = "workspaces/frenzy" # optional; REPLACES the common workspace for this variant
# ADDITIVE references on top of the common ones; same `{ view, path }` shape as a
# `[[reference]]`. Lets a view differ per variant (for example a per-variant menu).
reference = [{ view = "title", path = "reference/menu-base.html" }]
# ADDITIVE reviewer checklist items on top of the common ones (see below); same
# `{ id, title, text }` shape as a `[[review_item]]`. Lets a mode-only item be
# checked only when this variant runs.
review_item = []

# Common reference views, seeded for EVERY variant. A reference is EITHER an HTML
# mockup rendered to a screenshot (`path`) OR a static image/video served as-is
# (`media`) — exactly one. A rendered source is not seeded; a static one is.
# References are not validated unless a check below names them.
[[reference]]
view = "gameplay"            # view slug
path = "reference/gameplay.html" # rendered mockup (relative to this folder)
# A static media reference instead of a rendered mockup (image or .mp4):
# [[reference]]
# view = "intro"
# media = "reference/intro.mp4"  # served as-is; kind inferred from the extension

# Proof of implementation, requested for EVERY variant. Each declares a `dest`
# path the build must write a screenshot or .mp4 to as evidence; the spec that
# asks for it must reference the same path. Validation records whether each is
# present (informational). The media kind is inferred from the extension.
[[proof]]
id = "title"                 # stable slug, recorded in validation and paired by review items
name = "Title menu"          # display name (optional; default humanizes the id)
dest = "proof/title.png"     # where the build must write it (relative to the run root)

# Validation checks (opt-in). Only declared checks run.
[[check]]
view = "title"               # the view this check records under
name = "Title"               # display name (optional; default humanizes the view slug)
reference = "title"          # baseline: the rendered screenshot of this reference
actions = []                 # actions to drive the build into the view (empty = on load)

# Reviewer checklist items, common to every variant. Reporter-side material (NOT
# seeded): each names something a reviewer must explicitly check after playing
# the build. A variant may add its own (see the variant's `review_item` above).
[[review_item]]
id = "ball-spin"             # stable slug, recorded with the reviewer's verdict
title = "Paddle spin"        # short heading shown above the item (numbered) in the reviewer UI
text = "Swinging a paddle as the ball contacts it imparts spin." # what to check
reference = "gameplay"       # optional: a reference view shown as the EXPECTED target
proof = "title"              # optional: a proof id whose SUBMITTED media is shown
```

- `name`, `difficulty`, and `tags` are site-facing metadata used to present and
  filter the case; they have no bearing on how a run is executed. All three are
  **required**, though `tags` may be an empty list.
- `summary` is an optional one- or two-sentence abstract shown on the site's test
  case cards. Unlike `description` it is authored **inline** as plain text rather
  than as a file, so it stays short and renders safely inside the card's link;
  the longer `description` is shown on the detail page. Like `description` it is
  **never seeded** into a run — it is site-only prose.
- `description` is an optional path to a Markdown file describing the case for
  the site. Unlike the specs and `assets`, it is **never seeded** into a run — it
  is site-only prose. Like every other path it must resolve inside the version
  folder, and it is validated to exist when declared.
- `prompt` is **required** and points at the Handlebars template that becomes
  the instruction handed to the harness. The template is **rendered, not
  seeded**; see [Prompt template](/testing/end-to-end/overview/#prompt-template).
- `max_runtime_seconds` is the maximum wall-clock duration the harness session
  is allowed before the run container is torn down and the run aborts. It exists
  so a stuck or runaway session can never run unbounded. It defaults to `3600`
  (one hour) when omitted and must be greater than zero. This is the per-case
  default; a run can override it for a single invocation (for example
  `tcab run --max-runtime <seconds>`).
- `workspace` is an optional path to a **starter directory** whose contents are
  seeded into the root of the run before the specs (see
  [Workspace](/testing/end-to-end/overview/#workspace)). A variant may override
  it with its own `workspace` (see [Variants](/testing/end-to-end/overview/#variants)).
  Like every path it must resolve inside the version folder and is validated to
  be a directory.
- `init` is an optional **init command** run inside the run container once the
  workspace and specs are seeded and before the harness starts (see
  [Init](/testing/end-to-end/overview/#init)). It must be non-empty when declared.
- The `[build]` table is **required** and declares the commands validation runs
  to turn a produced implementation into a served static site: `install`
  (dependency install) and `build` (the static build). Both must be stated
  explicitly — there are no defaults, so a case always records exactly how its
  implementation is built. Each runs from the implementation's repository root,
  and neither may be empty. `npm ci` is the conventional `install` because it
  requires a committed lockfile and installs exactly what it pins, matching the
  deployed build; a case may pin a different toolchain but must still emit a
  static build into `dist/`, `build/`, or `out/`. Both steps are reported in the
  run's [validation results](/components/core/validation/#results). See
  [Evaluation](/testing/end-to-end/evaluation/#load-check).
- Each `[[spec]]` declares a **common** spec — one seeded for every variant — by
  mapping a `source` file inside the version folder onto a `dest` path in the
  run workspace. A `source` ending in `.hbs` is a Handlebars template rendered
  into its `dest` (see [Spec templates](/testing/end-to-end/overview/#spec-templates));
  any other `source` is
  seeded verbatim. The rendered reference screenshots are seeded too. Asset
  entries may be files or directories; a directory is seeded recursively.
- Each `[[variant]]` declares a build the case offers. A run selects exactly one
  variant, which seeds the common specs plus the variant's own `spec` entries;
  see [Variants](/testing/end-to-end/overview/#variants).
- Each `[[reference]]` declares a **common** reference view, seeded as a visual
  target for **every** variant. A reference is **either** an HTML mockup rendered
  to a screenshot (`path`, whose source is never seeded) **or** a static image or
  `.mp4` served as-is (`media`, which is seeded and served unchanged) — exactly
  one of the two; declaring both or neither is rejected. A static reference's
  media kind (image vs. video) is inferred from its extension, letting the
  "expected" side of a review item be a video or a prepared still. A variant may
  declare additional, variant-specific references through its own `reference`
  array; see [Variants](/testing/end-to-end/overview/#variants). A view slug must
  not be declared both as a
  common reference and by a variant, and a variant must not declare the same view
  twice. All paths are relative to the version folder and must resolve inside it,
  keeping a version self-contained.
- Each `[[proof]]` declares a **proof-of-implementation** artifact the build is
  asked to produce, requested for **every** variant. It names a stable `id`
  (recorded in the run's [validation results](/components/core/validation/#results)
  and used to pair a review item with the submitted media), an optional `name`
  (defaulting to a humanized `id`), and a `dest` path the build must write the
  proof to, relative to the run workspace root. The media kind (image or video)
  is inferred from the `dest` extension (`png`/`jpg`/`jpeg`/`webp`/`gif` →
  image, `mp4` → video); any other extension is rejected. Unlike specs and
  references a proof is **not seeded** — it is *output* the agent produces during
  the run — so the spec that requests it must reference the same `dest`. A
  variant may declare additive proofs through its own `proof` array; an id must
  be unique within a variant's effective set, and a `dest` must not collide with a
  seeded file. See [Evaluation](/testing/end-to-end/evaluation/#proofs).
- Each `[[check]]` is an opt-in validation comparison. Its `reference` must name
  a reference view that resolves for **every** variant — a common reference, or
  one that each variant declares — whose rendered screenshot is the baseline;
  `actions` drive the built implementation into the view before capture. Its
  optional `name` is a display label, defaulting to a humanized form of `view`.
  See [Evaluation](/testing/end-to-end/evaluation/#checks).
- Each `[[review_item]]` declares a **common** reviewer checklist item — one a
  person must explicitly check when reviewing any variant — by a stable `id`
  (recorded with the verdict), a short `title` shown above the item in the
  reviewer UI, and the `text` a reviewer reads. A variant may declare
  **additive** items through its own `review_item` array (same
  `{ id, title, text }` shape); see [Variants](/testing/end-to-end/overview/#variants).
  Review items are
  reporter-side material: like the reference *source* and a case's
  `description`, they are **never seeded** into a run, so the model never
  receives the checklist. They restate observable requirements the seeded
  specification already states, so withholding them hides nothing. An item id
  must be unique within a variant's effective set (common plus that variant's
  own); a collision is rejected at resolution. An item may also pair an expected
  reference and the submitted proof with its check: the optional `reference` names
  a reference view (shown as the **expected** target) and the optional `proof`
  names a proof id (whose **submitted** media is shown), so the reviewer compares
  the target against the evidence before judging. The two are independent — an
  item may declare just a `proof` with no `reference` (a video clip with no still
  that meaningfully depicts it, say); the reviewer UI then shows that one side
  full width rather than reserving an empty pane. Each named id must resolve for
  the item's variant or resolution is rejected. See
  [Reviewing Test Run Results](/guides/reviewing-test-run-results/#work-the-checklist).
