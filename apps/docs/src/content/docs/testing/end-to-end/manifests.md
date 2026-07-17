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

The **`slug`** is the case's stable identity: it is the definition-store key and is
recorded in every run, so it — not the folder name — is what ties a run to its case.
It is declared explicitly rather than derived from the folder so the two are
**decoupled**: a case's folder can be renamed for tidiness while its slug stays put,
and the runs already published under that slug remain attached. In the common case the
slug simply equals the folder name; the exception in this repo is `carom/`, which pins
`slug = "pong"` to keep the runs published before its rename. A slug must be a valid
kebab-case token (lowercase letters, digits, single hyphens between them) and be
declared identically on every version of a folder. A whole-catalog ingest keys the
store by the slug and prunes any stored case the checkout no longer declares (sparing
any a published or pending run still references), so a rename that keeps the slug
overwrites in place instead of leaving a duplicate.

```toml
# test-cases/<type>/<difficulty>/<folder>/<version>/test-case.toml
slug = "pong"                # stable identity (required); the store key + recorded in every run
name = "Carom"               # human-readable display name (site-facing)
difficulty = "medium"        # relative difficulty: easy | medium | hard (required)
tags = ["arcade", "2d"]      # free-form classification tags (site-facing, required)
summary = "..."              # optional one- or two-sentence abstract for the site cards (inline; NOT seeded)
description = "description.md" # optional site-facing prose (relative path; NOT seeded)
changelog = "changelog.md"   # REQUIRED per-version changelog entry (relative path; NOT seeded)
prompt = "prompt.hbs"        # the prompt template handed to the harness (required)
max_runtime_hours = 0.5      # cap on the harness session before it's stopped (default 1)
experimental = false         # optional; true hides the case from the UI unless the deployment enables experimental cases (default false)
workspace = "workspaces/base" # optional starter directory; its files seed the run root before the specs
init = "npm install"         # optional command run in the container after seeding, before the harness
assets = []                  # asset files/directories, seeded (relative paths)
packages = []                # Test Cabinet packages installed into the run, e.g. ["@test-cabinet/particle-runtime"]

# Variants: an ORDERED list of paths to standalone variant files (the first is the
# default). Exactly one variant runs per run, and its slug is recorded in the run
# record. Each path is relative to the version folder; by convention the files
# live under `variants/`, and each is a self-contained TOML document (see "Variant
# files" below). Because `variants` is a ROOT key, it must appear BEFORE the first
# table header (`[build]`, `[[spec]]`, …) in this file.
variants = [
  "variants/base.toml",      # first entry = the default variant
  "variants/frenzy.toml",
]

# How validation builds the produced implementation into a served static site.
# Required: a case must state both commands explicitly; there are no defaults.
[build]
install = "npm ci"           # dependency install command (required)
build = "npm run build"      # static-build command (required)

# Common specs, seeded for EVERY variant. Each maps a `source` inside the version
# folder to a `dest` in the run's workspace. A `.hbs` source is rendered (see Spec
# templates); any other source is seeded verbatim. `dest` is OPTIONAL and defaults
# to `source` with a trailing `.hbs` extension removed — so `specs/overview.md`
# seeds to `specs/overview.md`, and `specs/overview.md.hbs` renders to
# `specs/overview.md`. Give an explicit `dest` only to remap the seeded path.
[[spec]]
source = "specs/overview.md" # source path (relative to this folder); dest defaults to it

[[spec]]
source = "specs/mode.md.hbs" # .hbs source is rendered; dest defaults to "specs/mode.md"

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
# path the build must write a screenshot or .webm clip to as evidence; the spec
# that asks for it must reference the same path. Validation records whether each
# is present (informational). The media kind is inferred from the extension.
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

# COMMON reviewer checklist items, checked for EVERY variant. Reporter-side
# material (NOT seeded): each names something a reviewer must explicitly check
# after playing the build. A variant may add its own in its variant file.
[[review_item]]
id = "ball-spin"             # stable slug, recorded with the reviewer's verdict
title = "Paddle spin"        # short heading shown above the item (numbered) in the reviewer UI
text = "Swinging a paddle as the ball contacts it imparts spin." # what to check
weight = 1                   # points this item is worth toward the score (required, > 0)
reference = "gameplay"       # optional: a reference view shown as the EXPECTED target
proof = "title"              # optional: a proof id whose SUBMITTED media is shown
domain = "single-player"     # optional: a COMMON item may name only a COMMON domain
# optional: name-only sub-items graded pass/fail independently (see "Sub-items" below).
# When present, the reviewer verdicts each sub-item and `weight` splits evenly across them.
sub_items = [
  { id = "stationary", title = "No spin while stationary" },
  { id = "moving", title = "Imparts spin while moving" },
]

# COMMON scoring domains, rated for EVERY variant. The reviewer rates each
# independently while playing the build; the run's OVERALL rating is the WORST
# across the run variant's EFFECTIVE domain set (these common domains plus any the
# run's variant declares in its own file). At least one common domain is required.
[[domain]]
id = "single-player"         # stable slug, recorded with the per-domain rating
name = "Single Player"       # display name (optional; default humanizes the id)
description = "Solo play against the AI opponent." # what the reviewer is rating (required)
```

Each `variants` entry points at a standalone variant file — a TOML document whose
**top-level keys are the variant's own fields**. Every path inside it is relative
to the **version folder** (not the variant file's location), exactly as an inline
variant was. A variant seeds the common specs plus its own additive specs, may
supply variant-specific references, review items, and workspace, and may declare
**additional scoring domains** rated only when it runs:

```toml
# test-cases/<type>/<difficulty>/<slug>/<version>/variants/frenzy.toml
slug = "frenzy"              # stable slug, recorded in the run record
name = "Frenzy"             # display name (optional; default humanizes the slug)
description = "..."          # optional inline prose (site-facing)
workspace = "workspaces/frenzy" # optional; REPLACES the common workspace for this variant
reference_implementation = "reference-impl/frenzy" # optional; the CORRECT buildable static build of this variant (NEVER seeded)
# ADDITIVE specs on top of the common specs; same `{ source, dest }` shape as a
# `[[spec]]`, and `dest` likewise defaults to `source` (trailing `.hbs` stripped).
spec = [{ source = "specs/modes/frenzy.md" }]
# ADDITIVE references on top of the common ones; same `{ view, path }` shape as a
# `[[reference]]`. Lets a view differ per variant (for example a per-variant menu).
reference = [{ view = "title", path = "reference/menu-frenzy.html" }]

# ADDITIVE reviewer checklist items on top of the common ones; same shape as a
# `[[review_item]]`. A variant item may name a COMMON domain OR one of this
# variant's OWN domains (below).
[[review_item]]
id = "frenzy-escalation"     # unique within the variant's effective set (common + own)
title = "Frenzy escalation"
text = "Each hit multiplies ball speed with no cap, so the rally visibly escalates."
weight = 1
domain = "frenzy"

# ADDITIONAL scoring domains, rated ONLY when this variant runs — layered on top of
# the case's common domains. A domain id must be unique across the common domains
# and this variant's own.
[[domain]]
id = "frenzy"
name = "Frenzy"
description = "The escalating Frenzy mode: uncapped speed that visibly ramps every hit."
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
- `changelog` is **required** and points at a Markdown file recording what changed
  **in this version** of the case, so no revision ships without a note. The first
  version typically just reads `Introduced.`; a later version describes its change
  (for example, a proof clip switching format). Each version folder carries its own
  entry, and the site aggregates every version's entry into one **newest-first**
  changelog on the case's detail page. Like `description` it is site-only prose —
  **never seeded** into a run — must resolve inside the version folder, and is
  validated to exist.
- `prompt` is **required** and points at the Handlebars template that becomes
  the instruction handed to the harness. The template is **rendered, not
  seeded**; see [Prompt template](/testing/end-to-end/overview/#prompt-template).
- `max_runtime_hours` is the maximum wall-clock duration the harness session is
  allowed before the run container is torn down and the run aborts. It is
  authored in hours and fractional values are allowed (for example `0.5` for
  thirty minutes, `1.5` for ninety), because every cap is long enough that
  seconds add no useful precision. It exists so a stuck or runaway session can
  never run unbounded. It defaults to `1` (one hour) when omitted and must be a
  positive number. This is the per-case default; a run can override it for a
  single invocation (for example `tcab run --max-runtime <hours>`).
- `experimental` is an optional boolean, defaulting to `false`, that marks a case
  as **still being iterated on** — not yet ready to publish runs for. It applies
  to every test type. A deployment only offers experimental cases to the UI when
  it opts in with the `TCAB_BACKEND_ALLOW_EXPERIMENTAL` environment variable
  (truthy); otherwise an experimental case is **hidden from the catalog and
  refuses to resolve**, so it is treated as if it does not exist — and therefore
  is never run or published. The local k3d cluster (`make -C deployments/local
  local-up`) enables experimental cases; production leaves the variable unset.
  The flag is purely a visibility filter and has no effect on how a run executes.
- `workspace` is an optional path to a **starter directory** whose contents are
  seeded into the root of the run before the specs (see
  [Workspace](/testing/end-to-end/overview/#workspace)). A variant may override
  it with its own `workspace` (see [Variants](/testing/end-to-end/overview/#variants)).
  Like every path it must resolve inside the version folder and is validated to
  be a directory.
- `init` is an optional **init command** run inside the run container once the
  workspace and specs are seeded and before the harness starts (see
  [Init](/testing/end-to-end/overview/#init)). It must be non-empty when declared.
- `packages` is an optional list of **Test Cabinet packages** — the repo's own
  `@test-cabinet/*` runtime libraries — to make available to the build as
  ordinary installed dependencies (see
  [Packages](/testing/end-to-end/overview/#packages)). It is how a case that must
  consume a *produced* asset whose format needs a runtime to interpret — a
  [particle](/testing/asset-generation/particle-binaries/) `system.json` a game
  plays by simulating it live, a voxel rig a game poses — hands the model the
  library that plays it, rather than asking the model to reimplement the runtime
  from a schema. Each entry is a package **name** (not a path), and every name
  must be one of the **shippable packages** in the host package store (listed in
  [`containers/README.md`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/containers/README.md#the-shippable-test-cabinet-packages));
  an unknown name is rejected at resolution. `packages` is **end-to-end only** —
  an asset-generation case that declares it is rejected. The harness does **not**
  modify your `package.json`: you ship a `workspace` whose `package.json` already
  depends on each declared package via an **in-repo relative** `file:` spec —
  `"@test-cabinet/particle-runtime": "file:./.tcab/packages/@test-cabinet/particle-runtime"`
  — and `packages` is the declaration resolution validates that file against. At
  seed time the named libraries are **vendored into the run repo** at
  `.tcab/packages/` (and committed), so that relative path resolves wherever the
  produced tree later lives — the run container, the validation host, or a clone
  of the published repo. A case that declares a package but ships no
  `package.json`, omits the dependency, or points it anywhere other than that
  in-repo `file:` path is **rejected at resolution**, so a misconfiguration
  surfaces at authoring time rather than leaving the model to discover the missing
  dependency mid-run. The model then
  installs and imports it like any other dependency; see
  [Packages](/testing/end-to-end/overview/#packages) for the model-facing contract
  and why a `packages` case's `init` must run `npm install` (not `npm ci`). Each
  declared package is surfaced on the case's **Inputs** tab (tagged `Package`) with
  a short description of what it provides. That description is **UI-only** — it is
  never seeded into a run — and is defined once, centrally, next to the shippable
  package list in `core` (not per case), so every case that ships a package shows
  the same description; you declare only the **name** in the manifest.
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
  run workspace. `dest` is **optional**: it defaults to `source` with a trailing
  `.hbs` extension removed, so `specs/x.md` seeds to `specs/x.md` and
  `specs/x.md.hbs` renders to `specs/x.md`; give an explicit `dest` only to remap
  the seeded path. A `source` ending in `.hbs` is a Handlebars template rendered
  into its `dest` (see [Spec templates](/testing/end-to-end/overview/#spec-templates));
  any other `source` is
  seeded verbatim. An optional `kind` marks the file's **role**: it defaults to
  `spec` (a prose specification the model reads) and may be set to `script` for an
  executable starter the model edits and runs — the case's `build.py` starter stub
  the [Blender](/testing/asset-generation/blender-binaries/) asset kind seeds, whose
  `dest` coincides with `[output].actions`. `kind` is **presentation only**: it does
  not change how the file is seeded, only that the **Inputs** tab tags it `Script`
  rather than `Spec`. The rendered reference screenshots are seeded too. Asset
  entries may be files or directories; a directory is seeded recursively.
- The `variants` list names the builds the case offers, in order, as paths to
  standalone **variant files** (the first is the default). It is a root key, so it
  must precede the first table header. A run selects exactly one variant, which
  seeds the common specs plus the variant's own `spec` entries; each variant file
  is a self-contained TOML document whose top-level keys are the variant's fields,
  and every path inside it resolves against the version folder. See
  [Variants](/testing/end-to-end/overview/#variants).
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
  image, `webm`/`mp4` → video); any other extension is rejected. A **video
  proof** should be a `.webm` — the format Playwright records natively, so a run
  captures it without transcoding; the public gallery transcodes it to `.mp4` at
  snapshot time for universal (incl. iOS/Safari) playback. Unlike specs and
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
  reviewer UI, the `text` a reviewer reads, and a `weight`: the number of points
  the item is worth toward the run's **score**. A variant may declare
  **additive** items through its own `review_item` array (same shape); see
  [Variants](/testing/end-to-end/overview/#variants). Review items are
  reporter-side material: like the reference *source* and a case's
  `description`, they are **never seeded** into a run, so the model never
  receives the checklist. They restate observable requirements the seeded
  specification already states, so withholding them hides nothing. An item id
  must be unique within a variant's effective set (common plus that variant's
  own); a collision is rejected at resolution. `weight` is **required** and must
  be greater than zero — a `pass` verdict earns the item's weight and a `fail`
  earns none, and the run's score is the earned weight over the total declared
  weight (verdicts are binary; there is no "not applicable"). An item may also
  carry an optional `domain` naming the scoring domain it rolls up to; a common
  item may name only a **common** domain, while a variant's own item may name a
  common domain **or** one of that variant's own domains. A general item that
  applies to every mode omits it.
  An item may also pair an expected reference and the submitted proof with its
  check: the optional `reference` names a reference view (shown as the
  **expected** target) and the optional `proof` names a proof id (whose
  **submitted** media is shown), so the reviewer compares the target against the
  evidence before judging. The two are independent — an item may declare just a
  `proof` with no `reference` (a video clip with no still that meaningfully
  depicts it, say); the reviewer UI then shows that one side full width rather
  than reserving an empty pane. Each named id must resolve for the item's variant
  or resolution is rejected. An item may also break into **sub-items** — see
  [Sub-items](#sub-items) below. See
  [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/#work-the-checklist).
- Each `[[domain]]` declares a **scoring domain** the reviewer rates
  independently — for example a game's `single-player` and `versus` modes — by a
  stable `id` (recorded with the per-domain rating), an optional `name`
  (defaulting to a humanized `id`), and a required `description` telling the
  reviewer what they are rating. A case declares its **common** domains with
  `[[domain]]` in `test-case.toml` (at least one is **required**), and every
  variant is rated on those. A variant may declare **additional** `[[domain]]`
  tables in its own file; the **effective** set a reviewer rates for a run is the
  common domains plus that run's variant's own. Domain ids must be unique across
  the common domains and any given variant's own. The run's **overall rating** is
  the *worst* rating across its effective domains, so a flawless mode cannot mask a
  broken one. Review items roll up to a domain through their optional `domain`. See
  [Evaluation](/testing/end-to-end/evaluation/#scoring).
- `reference_implementation` is an **optional** per-variant key naming a
  **reference implementation** — a directory holding a buildable static web
  project that is the *correct* implementation of this variant, authored in-repo
  and versioned with the case. It is declared as a top-level key of a **variant
  file** (not `test-case.toml`), so each variant may point at its own correct build
  and a variant that omits the key simply has none. Its value is a path resolved
  against the **version folder** (`test-cases/<type>/<difficulty>/<folder>/<version>/`), by convention
  `reference-impl/<variant>/`. The project is built with the case's existing
  `[build]` commands — the shared `install` then `build`, run from that
  directory — and its static output must land in the same `dist/`, `build/`, or
  `out/` a run's build does. A reference implementation is **never seeded** into a
  run: it is the authored answer, so exposing it to a model would defeat the case.
  It exists only to be **published** out-of-band — deployed to Cloudflare Pages by
  [`tcab publish-reference`](/components/cli/overview/#commands), whose served URL
  the backend records — and then shown on the case page's **Reference** tab
  (inline, with a fullscreen option). Do not confuse it with a **reference visual
  mockup** (`[[reference]]`): a mockup is a rendered screenshot of one view, seeded
  as a *target* the model builds toward, whereas a reference implementation is the
  whole playable game and is never seeded. See
  [Reference implementations](/components/core/results/#reference-implementations).

## Sub-items

A `[[review_item]]` that covers a section of the build often has several points a
reviewer would grade independently. Rather than collapsing them into one pass/fail
(where a single missed point fails the whole item), an item may declare **sub-items**:
name-only entries, each verdicted `pass`/`fail` on its own — an academic question's
"2a", "2b", …

```toml
[[review_item]]
id = "ball-spin"
title = "Paddle spin"
text = "Swinging a paddle as it strikes the ball curves the ball's flight afterward; a stationary paddle imparts no new spin."
weight = 2
sub_items = [
  { id = "stationary", title = "No spin while stationary" },
  { id = "moving", title = "Imparts spin while moving" },
]
```

Each sub-item carries only an `id` (which keys its verdict) and a `title` (its
heading, shown lettered a, b, c… in the reviewer UI); it has **no** `text`, `weight`,
or media of its own — the parent item's `text`, reference, and proof are the shared
context. Rules:

- **Ids** must be non-empty and unique **within the item**. A sub-item's verdict is
  recorded under the composite id `<item id>.<sub-item id>` (for example
  `ball-spin.moving`), so it must not collide with any other item's verdict id.
- **Scoring** splits the item's `weight` evenly across its sub-items: the item earns
  `weight × (passed sub-items ÷ total sub-items)`. So a two-point item with two
  sub-items awards one point per passed sub-item, and a one-point item with three
  awards a third each. The item's earned score is therefore **fractional** in general,
  while the case's total available points are unchanged (still the sum of item
  weights).
- **Completeness.** Every sub-item must be verdicted before a run can be published,
  exactly as every whole-item must be — an item with sub-items has no verdict of its
  own.

Sub-items are declared inline as an array of `{ id, title }` tables (shown above) or,
equivalently, as repeated `[[review_item.sub_item]]` tables. They are available to a
variant's own additive items too, with the same shape and rules. See
[Evaluation](/testing/end-to-end/evaluation/#scoring) for how they roll up to the
score.

## Automated validation

A case that mandates [instrumentation](/testing/end-to-end/instrumentation/) can
mark a review item as **automatically validated**: The Test Cabinet drives a
reporter-side **debug script** against the build's debug API to decide the item's
verdict(s) and synthesize its proof media, rather than leaving it to a human. Two
manifest pieces declare this.

The case names its debug-API handle **once**, in a root `[instrumentation]` table:

```toml
[instrumentation]
handle = "__carom"           # the window global the build installs its debug API on
```

- `handle` is the `window` property name the build installs its debug API on
  (`window.__carom` here), **without** the `window.` prefix. It must be a plain
  identifier and is **required** as soon as any review item declares a `validation`
  script. It is reporter-side and **never seeded**; the seeded specification
  documents the same handle independently as an ordinary game debug feature (never
  naming The Test Cabinet — see
  [Authoring guidelines](/testing/end-to-end/instrumentation/#authoring-guidelines)).

An item then opts into automation with a `validation` table naming the **script**
that drives the handle and the media **outputs** the script produces:

```toml
[[review_item]]
id = "ball-spin"
title = "Paddle spin"
text = "Swinging a paddle as the ball contacts it imparts spin."
weight = 1
sub_items = [
  { id = "stationary", title = "No spin while stationary" },
  { id = "moving", title = "Imparts spin while moving" },
]
validation = { script = "validation/ball-spin.mjs", outputs = [
  { id = "rally", name = "Paddle contact", kind = "video" },
] }
```

- `script` is a path, relative to the version folder (by convention
  `validation/<item>.mjs`), to an ES-module driver that default-exports
  `async (api) => ({ verdicts, notes })`. It drives the debug API — `reset`,
  `step`, `snapshot`, and the case's control operations — to set up a scenario,
  run the **real** simulation forward, and read the outcome back, returning a
  pass/fail for each of the item's verdict ids (the item's own id, or one per
  sub-item id). Like a review item, a debug script is **reporter-side and never
  seeded**. Per run, validation runs it against the model's build to capture the
  *actual* media. The *baseline* — the same script driven against the variant's
  `reference_implementation` — is a fixed property of the case version, so it is
  captured **once** at `tcab publish-reference` time, committed under the version
  folder (`validation-baseline/<variant>/`), and served case-scoped; a run never
  re-drives the reference implementation. The reviewer sees expected-vs-observed
  media side by side.
- `outputs` declares the media the script captures, each an `{ id, name, kind }`
  where `kind` is `image` (a still the script screenshots) or `video` (a clip
  recorded across the drive). `name` defaults to a humanized `id`. Output ids must
  be unique within the script, and a script may declare **at most one** `video`
  output. Each output is served under the flat name `<item>__<output>.<ext>` — the
  same name for the run-scoped *actual* media and the case-scoped *baseline* media,
  told apart by where they are served from, not their name.
- A `validation` item may **not** be a graded [game-jam](/testing/game-jam/overview/)
  category (there is no pass/fail to auto-decide), and its `weight`/`sub_items`
  scoring is unchanged — automation only pre-decides the same verdicts a human
  would, in a distinguishable color the reviewer can override.

The debug API is a **gate**: if a declared script cannot run against a conformant
build — the handle is missing, a call throws, the return is malformed, or a
declared output is never produced — the run **fails outright and is rated broken**,
with no human review (see
[The debug API is a gate](/testing/end-to-end/instrumentation/#the-debug-api-is-a-gate)).
A host with no browser to drive with degrades instead of gating, exactly as a
[check](/components/core/validation/#checks) does. Which properties a script
asserts, like every other reviewer-side detail, are **not** stated in the seeded
spec; the spec states the observable requirement and mandates the instrument.
