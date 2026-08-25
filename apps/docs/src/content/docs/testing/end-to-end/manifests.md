---
title: Manifests
---

Each end-to-end test case version declares its contents in a `test-case.toml`
manifest in the version folder. Resolution reads this manifest to decide what is
seeded into a run, which engines a run may select, how the produced
implementation is built and checked, and what a reviewer grades. For what the
declared pieces mean, see [Overview](/testing/end-to-end/overview/).

Every path a manifest names is relative to the version folder and must resolve
inside it, so a version stays self-contained. A declared path is validated to
exist when the case resolves.

## The case manifest

```toml
# test-cases/<type>/<difficulty>/<folder>/<version>/test-case.toml
slug = "pong"                # stable identity (required); the store key, recorded in runs
name = "Carom"               # human-readable display name (site-facing, required)
type = "end-to-end"          # test type (default "end-to-end")
difficulty = "medium"        # relative difficulty: easy | medium | hard (required)
tags = ["arcade", "2d"]      # classification tags (site-facing, required; may be empty)
summary = "..."              # optional abstract for the site cards (inline; NOT seeded)
description = "description.md" # optional site-facing prose (relative path; NOT seeded)
changelog = "changelog.md"   # REQUIRED per-version changelog (relative path; NOT seeded)
prompt = "prompt.hbs"        # the prompt template handed to the harness (required)
max_runtime_hours = 0.5      # cap on the harness session before it is stopped (default 1)
experimental = false         # optional; true hides the case unless the deployment opts in
workspace = "workspaces/base" # optional starter directory, seeded into the run root
init = "npm install"         # optional command run after seeding, before the harness
assets = []                  # asset files/directories, seeded (relative paths)
packages = []                # Test Cabinet packages the build imports (npm names)
engines = ["none"]           # supported engines, no version range (omit for ["none"])

# Variants: an ORDERED list of paths to standalone variant files (the first is the
# default). Exactly one variant runs per run, and its slug is recorded in the run
# record. At least one entry is required. Because `variants` is a ROOT key, it must
# appear BEFORE the first table header (`[build]`, `[[spec]]`, …) in this file.
variants = [
  "variants/base.toml",      # first entry = the default variant
  "variants/frenzy.toml",
]

# Supported engines carrying a version range, one table per engine. See
# "Supported engines".
[[engine]]
slug = "simple-2d"           # engine slug the catalogue knows (required)
min_version = "1.0.0"        # lowest supported engine version, inclusive (required)
max_version = "2.0.0"        # optional exclusive ceiling; unbounded by default

# How validation builds the produced implementation into a served static site.
# Required: a case must state both commands explicitly; there are no defaults.
[build]
install = "npm ci"           # dependency install command (required, non-empty)
build = "npm run build"      # static-build command (required, non-empty)

# The TypeScript toolchain run over the produced implementation. Required. See
# "The TypeScript toolchain".
[toolchain]
typecheck = "npx tsc --noEmit"     # required; a non-zero exit rates the run broken
lint = "npx eslint ."              # optional; recorded
format = "npx prettier --check ."  # optional; recorded
test = "npx vitest run --coverage" # optional; recorded with its test count and coverage

# Common specs, seeded for EVERY variant. Each maps a `source` inside the version
# folder to a `dest` in the run's workspace. A `.hbs` source is rendered; any other
# source is seeded verbatim. `dest` defaults to `source` with a trailing `.hbs`
# removed, so `specs/overview.md` seeds to `specs/overview.md` and
# `specs/mode.md.hbs` renders to `specs/mode.md`.
[[spec]]
source = "specs/overview.md" # source path (required); dest defaults to it
# dest = "specs/renamed.md"  # optional remap
# kind = "spec"              # optional role: spec (default) | script

# Common reference views, seeded for EVERY variant. Retained so shipped case
# versions keep resolving; a new case declares none. A reference is EITHER an HTML
# mockup rendered to a screenshot (`path`) OR a static image/video served as-is
# (`media`) — exactly one. A rendered source is not seeded; a static one is.
[[reference]]
view = "gameplay"            # view slug
path = "reference/gameplay.html" # rendered mockup
# media = "reference/intro.mp4"  # served as-is; media kind inferred from the extension

# Proof of implementation, requested for EVERY variant. Retained so shipped case
# versions keep resolving; a new case declares none. Each declares a `dest` the
# build must write a screenshot or clip to as evidence; the spec that asks for it
# must name the same path. Validation records whether each is present.
[[proof]]
id = "title"                 # stable slug, recorded in validation; paired by review items
name = "Title menu"          # display name (optional; defaults to a humanized id)
dest = "proof/title.png"     # where the build must write it (relative to the run root)

# Validation checks (opt-in). Retained so shipped case versions keep resolving; a
# new case declares none.
[[check]]
view = "title"               # the view this check records under
name = "Title"               # display name (optional; defaults to a humanized view slug)
reference = "title"          # baseline reference view (optional; defaults to `view`)
actions = []                 # actions driving the build into the view (empty = on load)

# The debug-API handle, required as soon as any review item declares a
# `validation` script. Reporter-side, never seeded.
[instrumentation]
handle = "__carom"           # the window property the build installs its debug API on
tick_hz = 120                # optional fixed simulation rate, in whole ticks per second

# COMMON reviewer checklist items, checked for EVERY variant. Reporter-side
# material (NOT seeded). A variant may add its own in its variant file.
[[review_item]]
id = "ball-spin"             # stable slug, recorded with the reviewer's verdict
title = "Paddle spin"        # short heading shown above the item in the reviewer UI
text = "Swinging a paddle as the ball contacts it imparts spin." # what to check
weight = 2                   # points this item is worth toward the score (required, > 0)
reference = "gameplay"       # optional: a reference view shown as the EXPECTED target
proof = "title"              # optional: a proof id whose SUBMITTED media is shown
domain = "single-player"     # optional: a COMMON item may name only a COMMON domain
# optional: name-only sub-items graded pass/fail independently (see "Sub-items").
sub_items = [
  { id = "stationary", title = "No spin while stationary" },
  { id = "moving", title = "Imparts spin while moving" },
]

# COMMON scoring domains, rated for EVERY variant. The reviewer rates each
# independently while playing the build; the run's OVERALL rating is the WORST
# across the run variant's EFFECTIVE domain set (these plus any the run's variant
# declares). At least one common domain is required.
[[domain]]
id = "single-player"         # stable slug, recorded with the per-domain rating
name = "Single Player"       # display name (optional; defaults to a humanized id)
description = "Solo play against the AI."  # what the reviewer is rating (required)
```

## The variant file

Each `variants` entry points at a standalone variant file whose top-level keys
are the variant's own fields. Every path inside it is relative to the version
folder rather than to the variant file's location. A variant seeds the common
specs plus its own additive specs, and may supply its own references, proofs,
review entries, workspace, and additional scoring domains.

```toml
# test-cases/<type>/<difficulty>/<folder>/<version>/variants/frenzy.toml
slug = "frenzy"              # stable slug, recorded in the run record; unique per case
name = "Frenzy"              # display name (optional; defaults to a humanized slug)
description = "..."          # optional inline prose (site-facing)
workspace = "workspaces/frenzy" # engineless cases only; REPLACES the common workspace
reference_implementation = "references/frenzy" # optional correct build (never seeded)

# In place of `workspace`, for a case that names engines: one starter directory per
# engine, replacing the case's whole `[workspaces]` table for runs of this variant.
[workspaces]
none = "workspaces/frenzy/none"
"simple-2d" = "workspaces/frenzy/simple-2d"

# In place of the bare `reference_implementation` path, for a case that names
# engines: one correct build per engine, keyed by engine slug.
[reference_implementation]
none = "references/none/frenzy"
"simple-2d" = "references/simple-2d/frenzy"

# ADDITIVE specs on top of the common specs; same `{ source, dest, kind }` shape as
# a `[[spec]]`, and `dest` likewise defaults to `source` with `.hbs` stripped.
spec = [{ source = "specs/modes/frenzy.md" }]
# ADDITIVE references; same shape as a `[[reference]]`.
reference = [{ view = "title", path = "reference/menu-frenzy.html" }]
# ADDITIVE proofs; same shape as a `[[proof]]`.
proof = [{ id = "frenzy-rally", dest = "proof/frenzy.webm" }]

# ADDITIVE reviewer checklist items; same shape as a `[[review_item]]`. A variant
# item may name a COMMON domain OR one of this variant's OWN domains.
[[review_item]]
id = "frenzy-escalation"     # unique within the variant's effective set (common + own)
title = "Frenzy escalation"
text = "Each hit multiplies ball speed with no cap, so the rally visibly escalates."
weight = 1
domain = "frenzy"

# ADDITIONAL scoring domains, rated ONLY when this variant runs.
[[domain]]
id = "frenzy"
name = "Frenzy"
description = "The escalating Frenzy mode: uncapped speed that ramps every hit."
```

## Case keys

- `slug` is the case's stable identity: the definition-store key, recorded in
  every run, and what ties a run to its case. It is declared rather than derived
  from the folder name, so a folder can be renamed while the runs published
  under the slug stay attached. It must be a valid kebab-case token of lowercase
  letters and digits with single hyphens between them, and must be declared
  identically on every version of a folder. A whole-catalog ingest keys the
  store by slug and prunes any stored case the checkout no longer declares,
  sparing any that a published or pending run references, so a rename that keeps
  the slug overwrites in place.
- `name`, `difficulty`, and `tags` are site-facing metadata used to present and
  filter the case. All three are required, though `tags` may be an empty list.
- `type` selects the test type and defaults to `end-to-end`. The type decides
  which tables are required and which are rejected.
- `summary` is an optional one- or two-sentence abstract shown on the site's
  test case cards. It is authored inline as plain text so it renders safely
  inside the card's link. It is never seeded.
- `description` is an optional path to a Markdown file describing the case for
  the site's detail page. It is never seeded.
- `changelog` is required and points at a Markdown file recording what changed
  in this version, so no revision ships without a note. The first version
  typically reads `Introduced.`. The site aggregates every version's entry into
  one newest-first changelog on the case's detail page. It is never seeded.
- `prompt` is required and points at the Handlebars template that becomes the
  instruction handed to the harness. The template is rendered rather than
  seeded; see
  [Prompt template](/testing/end-to-end/overview/#prompt-template).
- `max_runtime_hours` is the maximum wall-clock duration the harness session may
  run before the container is torn down and the run aborts. It is authored in
  hours, fractional values allowed, must be a positive finite number, and
  defaults to `1`. A run can override it for a single invocation, for example
  `tcab run --max-runtime <hours>`.
- `experimental` marks a case as still being iterated on and defaults to
  `false`. A deployment offers experimental cases only when it sets
  `TCAB_BACKEND_ALLOW_EXPERIMENTAL` to a truthy value; otherwise an experimental
  case is hidden from the catalog and refuses to resolve, so it is never run or
  published. The flag is a visibility filter with no effect on how a run
  executes.
- `workspace` is an optional path to a starter directory whose contents seed
  into the root of the run before the specs; it must be a directory. A variant
  may replace it with its own. It is the engineless spelling and is rejected
  alongside `[workspaces]` or an engine. See
  [Workspace](/testing/end-to-end/overview/#workspace).
- `init` is an optional command run inside the run container once the workspace
  and specs are seeded and before the harness starts. It must be non-empty when
  declared. See [Init](/testing/end-to-end/overview/#init).
- `assets` lists files or directories seeded into the run at their path relative
  to the version folder; a directory is seeded recursively.
- `packages` lists the Test Cabinet runtime libraries the build imports. Each
  entry is a package name rather than a path, and every name must be one of the
  shippable packages staged into the host package store. It is valid for the
  end-to-end, full-stack, and game-jam types only. The case must ship a
  `workspace` whose `package.json` depends on each declared package, as a
  dependency or a dev dependency, via its in-repo `file:` spec under
  `.tcab/packages/`. A declared package missing from that file or pointing
  anywhere else is rejected at resolution. Each declared package is surfaced on
  the case's Inputs tab, tagged `Package`, with a description defined centrally
  in `core` rather than per case. See
  [Packages](/testing/end-to-end/overview/#packages).
- `engines` names the engines a run of this case version may select as bare
  slugs, each carrying no version range. A case version that declares no engine
  at all supports `none`, and nothing else. It is valid for the end-to-end,
  full-stack, and game-jam types only, and requires the `[workspaces]` spelling.
  See [Supported engines](#supported-engines).
- `variants` names the builds the case offers, in order, as paths to standalone
  variant files. The first is the default and at least one is required. It is a
  root key, so it must precede the first table header. See
  [Variants](/testing/end-to-end/overview/#variants).

## Case tables

- `[workspaces]` names one starter directory per engine, keyed by engine slug. It
  replaces `workspace`, and declaring both is rejected. See
  [The starter project](#the-starter-project).
- `[[engine]]` declares support for one engine together with the range of engine
  versions this case version supports. It carries the engine's `slug`, a
  required `min_version`, and an optional `max_version`. It requires the
  `[workspaces]` spelling. See [Supported engines](#supported-engines).
- `[build]` is required and declares the commands validation runs to turn a
  produced implementation into a served static site: `install` then `build`.
  Both are required, must be non-empty, and run from the implementation's
  repository root. `npm ci` is the conventional `install` because it requires a
  committed lockfile and installs exactly what it pins. A case may pin a
  different toolchain so long as it still emits a static build into `dist/`,
  `build/`, or `out/`. Both steps are reported in the run's validation results.
  A `module` key belongs to the adversarial and performance types and is
  rejected here.
- `[toolchain]` is required of a new case version and declares the TypeScript
  commands run over the produced implementation once it is installed: a required
  `typecheck` and the optional `lint`, `format`, and `test`. A version that
  declares none is neither checked nor gated. See
  [The TypeScript toolchain](#the-typescript-toolchain).
- `[[spec]]` declares a common spec, seeded for every variant, mapping a
  `source` inside the version folder onto a `dest` in the run workspace. `dest`
  defaults to `source` with a trailing `.hbs` removed; give it explicitly only
  to remap the seeded path. A `source` ending in `.hbs` is rendered as a
  [spec template](/testing/end-to-end/overview/#spec-templates); any other
  source is seeded verbatim. The optional `kind` is `spec` (the default, a prose
  specification) or `script` (an executable starter the model edits and runs).
  `kind` is presentation only: it changes how the Inputs tab tags the file, not
  how it is seeded.
- `[[reference]]` declares a common reference view, seeded as a visual target
  for every variant. It is retained so shipped case versions keep resolving, and
  a new case declares none. A reference declares exactly one of `path`, an HTML
  mockup rendered to a PNG whose source is never seeded, or `media`, a static
  file seeded and served unchanged. Declaring both or neither is rejected. A
  static reference's media kind is inferred from its extension: `png`, `jpg`,
  `jpeg`, `webp`, and `gif` are images; `webm` and `mp4` are video. A variant
  may declare additional references. A view slug must not be declared both
  commonly and by a variant, and a variant must not declare one twice.
- `[[proof]]` declares a proof-of-implementation artifact the build is asked to
  produce, requested for every variant. It is retained so shipped case versions
  keep resolving, and a new case declares none. It names a stable `id`, recorded
  in the run's validation results and used to pair a review item with the
  submitted media, an optional `name` defaulting to a humanized `id`, and a
  `dest` path relative to the run root. The media kind is inferred from the
  `dest` extension, from the same lists a reference uses, and any other
  extension is rejected. A video proof should be a `.webm`, the format
  Playwright records natively, which the public gallery transcodes to `.mp4` at
  snapshot time for playback on every browser. A proof is output the agent
  produces rather than a seeded file, so the spec that requests it must name the
  same `dest`, and that `dest` must not collide with a seeded file. A variant
  may declare additive proofs; an id must be unique within a variant's effective
  set. See [Proofs](/testing/end-to-end/evaluation/#proofs).
- `[[check]]` is an opt-in validation comparison, retained so shipped case
  versions keep resolving, and a new case declares none. `view` is the slug the
  result is recorded under, the optional `name` is a display label defaulting to
  a humanized `view`, and `reference` names the reference view whose rendered
  screenshot is the baseline, defaulting to `view`. That reference must resolve
  for every variant, either commonly or from each variant's own set. `actions`
  drives the built implementation into the view before capture; an empty list
  captures whatever the build shows on load. Each action is an inline table
  tagged by `type`:
  - `{ type = "wait", ms = 500 }` pauses for `ms` milliseconds.
  - `{ type = "key", key = "Enter" }` presses and releases a Playwright key.
  - `{ type = "hold", key = "ArrowUp", ms = 300 }` holds a key, then releases it.
  - `{ type = "click", x = 320, y = 180 }` clicks a logical-pixel point.

  See [Checks](/testing/end-to-end/evaluation/#checks).
- `[instrumentation]` names the case's debug-API surface once for the whole
  case. `handle` is the `window` property the build installs its debug API on,
  without the `window.` prefix, and must be a plain identifier of letters,
  digits, `_`, and `$` that does not start with a digit. It is required as soon
  as any verdict unit declares a `validation` script. The optional `tick_hz` is
  the case's fixed simulation rate in whole ticks per second and must be
  positive; it is what lets the validation runtime convert an exact number of
  stepped ticks into simulated time, and under an
  [engine](/components/core/engines/) it is the step a scripted
  [clock](/engines/simple-2d/apis/clocks/) takes by default. Omit it for a case
  whose build is clocked in real time. The table is reporter-side and never
  seeded; the seeded specification documents the same handle independently as an
  ordinary game debug feature.
- `[[review_item]]` declares a common reviewer checklist item. It carries a
  stable `id` recorded with the verdict, a short `title` shown above the item,
  the `text` a reviewer reads, and a `weight`: the points the item is worth
  toward the run's score. `id`, `title`, and `text` must be non-empty and
  `weight` must be greater than zero. Review items are reporter-side material
  and never seeded, so the model never receives the checklist; they restate
  observable requirements the seeded specification already states. An item id
  must resolve to verdict ids unique within a variant's effective set. The
  optional `domain` names the scoring domain the item rolls up to; a common item
  may name only a common domain, a variant's own item may name a common domain
  or one of that variant's own, and a general item omits it. The optional
  `reference` and `proof` keys pair the item with a reference view shown as the
  expected target and a proof id whose submitted media is shown; both are
  retained so shipped case versions keep resolving, and a new case declares
  neither. The two are independent, each named id must resolve for the item's
  variant, and the reviewer UI gives a single declared side the full width. An
  item may break into [sub-items](#sub-items) and may declare
  [automated validation](#automated-validation).
- `[[domain]]` declares a scoring domain the reviewer rates independently, by a
  stable `id` recorded with the per-domain rating, an optional `name` defaulting
  to a humanized `id`, and a required non-empty `description` telling the
  reviewer what they are rating. At least one common domain is required, and
  every variant is rated on all of them. A variant may declare additional
  domains, so the effective set for a run is the common domains plus that
  variant's own; ids must be unique across that set. The run's overall rating is
  the worst rating across the effective set. See
  [Scoring](/testing/end-to-end/evaluation/#scoring).

## The starter project

A case says which starter project a run is seeded with in exactly one way, and
which way it picks decides whether the case may name an
[engine](/components/core/engines/) at all.

| Spelling | Starter project | Engines |
| --- | --- | --- |
| `workspace` | One directory for the whole case. | None. A run of the case is the engineless run. |
| `[workspaces]` | One directory per engine. | Declared with `engines` and `[[engine]]`. |

A starter project is written against a runtime: its `package.json` declares the
engine's dependency, and the case-owned modules it ships are written against that
engine's API. One directory therefore cannot stand for two engines, so the
per-engine table is the only way a case may declare an engine.

```toml
engines = ["none"]

[[engine]]
slug = "simple-2d"
min_version = "1.0.0"

[workspaces]
none = "workspaces/base/none"
"simple-2d" = "workspaces/base/simple-2d"
```

The `[workspaces]` table names exactly the engines the case supports. Naming one
it does not support, and omitting one it does, are both rejected when the case
resolves. A variant may declare its own `[workspaces]`, which replaces the case's
whole table rather than one entry of it, so a variant that declares one covers
every supported engine.

The two spellings are exclusive: a manifest declaring `workspace` alongside
`[workspaces]`, an `engines` list, or an `[[engine]]` table is rejected. The same
rule applies to a variant file, which spells its starter project the way its case
does.

A per-engine case declares its [validators](/components/core/validation/) per
engine: a review item's `validation.script` is relative to the engine's validator
project, and the case ships that suite under `validation/<engine>/` for every
engine it supports. Resolution holds the declaration against each of them, so a
point cannot be decided under one engine and left to the reviewer under another.

## Supported engines

A case version declares the engines a run of it may select. The `engines` root
key lists bare slugs, each supported at any version:

```toml
engines = ["none", "simple-2d"]
```

An `[[engine]]` table declares one slug together with the engine versions this
case version supports, so a case pins the runtime contract its specification is
written against:

```toml
[[engine]]
slug = "simple-2d"
min_version = "1.0.0"
max_version = "2.0.0"
```

| Key | Required | Meaning |
| --- | --- | --- |
| `slug` | Yes | An engine slug the catalogue knows. |
| `min_version` | Yes | The lowest engine version a run may select, inclusive. |
| `max_version` | No | The version support stops at, exclusive. Unbounded by default. |

Both forms may appear in one manifest, and each slug is declared at most once
across the two. Every slug must be one the engine catalogue knows and every
declared version must be a semantic version, both checked when the case
resolves, before a run is spent. A `max_version` at or below `min_version` is
rejected there too.

`none` supplies no runtime and therefore carries no version, so it is declared
in the `engines` list and never in an `[[engine]]` table.

A case version that declares no engine at all supports `none` alone, which is the
engineless run a format `1` case offers. Once a version declares any engine, its
supported set is exactly what it declares. A case that builds both ways lists
`none` alongside the engine it also supports, and ships a starter project for
each.

A case declaring an engine that provides a runtime ships a starter project
containing a `package.json`, because the engine dependency is written into that
file at seed time. An engine's version is the version of its npm package in the
host package store, read at seed time and recorded on the run.

A run selects an engine by slug, and the version it receives is the one the
store holds. A run whose engine version falls outside the case's declared range
is refused before any container work begins, alongside the check that refuses an
engine the case does not support. Support and its range are declared per
version: widening or moving a range means adding a new case version, because the
specification carries the statements specific to the engine contract it targets.

## The TypeScript toolchain

An end-to-end build is written in TypeScript. The case ships the TypeScript,
lint, format, and test configuration in its `workspace`, and the produced
implementation compiles under it. The `[toolchain]` table declares the commands
that check it:

```toml
[toolchain]
typecheck = "npx tsc --noEmit"
lint = "npx eslint ."
format = "npx prettier --check ."
test = "npx vitest run --coverage"
```

| Key | Required | Effect |
| --- | --- | --- |
| `typecheck` | Yes | Gating. A non-zero exit rates the run `broken` and scores it zero. |
| `lint` | No | Recorded. |
| `format` | No | Recorded. |
| `test` | No | Recorded, with the test count and coverage it reports. |

Each declared command must be non-empty and runs from the implementation's
repository root once the `[build]` install has completed, so the dependencies it
needs are present. The commands run over the collected tree after the run's
container is gone, alongside the run's other post-run analysis, so a slow suite
costs the test case none of its runtime budget.

Each command is recorded on the run record's `toolchain` block with the command
itself, whether it ran, its exit code and a bounded excerpt of its output. The
excerpt is capped per command so a compiler emitting thousands of diagnostics
stays within a record every run listing deserializes. A command that could not be
started, because the install ahead of it failed or because it outran its
wall-clock cap, is recorded as not having run, with the reason.

A `typecheck` that ran and exited non-zero earns the run a `broken` overall
rating and a score of zero, because code that does not compile is not reviewable.
The run is still published with its results and the compiler output, so the
failure is legible. The gate is applied where a run's overall rating and score
are derived from its reviews, so a reviewer's own verdicts are recorded as
written and a run re-evaluated with the gate lifted recovers them. A typecheck
that never ran leaves the run ungated: a host that could not install dependencies
has learned nothing about whether the code compiles. The other three commands are
recorded and leave the run's rating and score to validation and the reviewer.

`test` runs the produced implementation's own test suite. The number of tests
that ran, the number that failed, and the coverage the command measured are read
from what the command printed and recorded with the run, so a build that ships a
tested implementation is distinguishable from one that ships none. A runner
reporting no counts or no coverage records their absence.

The same pass builds the implementation and opens the built site in a headless
browser as a smoke check, recording whether it booted, whether it painted a first
frame, and any console errors it logged. A host with no browser records the check
as not run.

A case version that declares no `[toolchain]` table is neither checked nor gated,
which is what keeps versions frozen before the table existed resolving unchanged.

## Variant keys

A variant file carries `slug`, an optional `name` defaulting to a humanized
slug, and optional site-facing `description` prose. Variant slugs must be unique
within the case. Its `spec`, `reference`, `proof`, and review entries are
additive on top of the case's common ones and take the same shape as the
corresponding case tables; `workspace` replaces the common workspace rather than
layering on it; `[[domain]]` tables add to the common domains.

`reference_implementation` declares the buildable static web project that is the
correct implementation of this variant, authored in-repo and versioned with the
case. It is declared on a variant file rather than in `test-case.toml`, so each
variant may point at its own; a variant that omits it has none. It takes one of
two forms, distinguished by TOML shape alone. A bare path names one directory
standing for every engine the case supports, the right form when the reference
build does not vary by engine, which includes every case supporting only `none`.
A table keyed by engine slug names one directory per engine, because the build a
reference demonstrates differs under each: an engine-backed build hands its
runtime surfaces to the engine and keeps only the game, while the engineless
build carries that runtime itself. The table must name exactly the engines the
case supports.

An engine-backed reference depends on the engine's package in the repository
(`packages/<slug>/`) by a relative `file:` path, which npm installs as a symlink,
so the reference builds and tests against the engine's current source. The
repository's npm workspace must therefore be installed and its packages built
(`npm ci && npm run build:packages` at the repository root) before a reference
is built.

By convention a per-engine directory lives at `references/<engine>/<variant>/`.
Each directory is built with the case's `[build]` commands run from it, and its
static output must land in the same `dist/`, `build/`, or `out/` a run's build
uses. A reference implementation is never seeded into a run: it is the authored
answer. It is published out-of-band by
[`tcab publish-reference`](/components/cli/overview/#commands), whose served URL
the backend records per engine, and shown on the case page's Reference tab. It
is also what
[`tcab capture-baselines`](/components/cli/overview/#commands) drives to
synthesize the baseline half of the validation media.

## Sub-items

A review item that covers a section of the build often has several points a
reviewer grades independently. Rather than collapsing them into one pass/fail,
an item may declare sub-items: name-only entries, each verdicted `pass` or
`fail` on its own.

```toml
[[review_item]]
id = "ball-spin"
title = "Paddle spin"
text = "Swinging a paddle as it strikes the ball curves the ball's flight afterward."
weight = 2
sub_items = [
  { id = "stationary", title = "No spin while stationary" },
  { id = "moving", title = "Imparts spin while moving" },
]
```

Each sub-item carries an `id` keying its verdict and a `title` shown lettered a,
b, c… in the reviewer UI. It has no prose or media of its own; the parent item's
`text`, reference, and proof are the shared context. The rules:

- Ids must be non-empty and unique within the item. A sub-item's verdict is
  recorded under the composite id `<item id>.<sub-item id>`, for example
  `ball-spin.moving`, which must not collide with any other verdict id in the
  variant's effective set.
- Scoring credits each sub-item one point, so an item with sub-items is worth
  the number of sub-items it declares. Declare the item's `weight` as that
  number so its stated worth matches what it can earn.
- Completeness. Every sub-item must be verdicted before a run can be published,
  exactly as every whole item must be. An item with sub-items has no verdict of
  its own.

Sub-items are declared inline as an array of `{ id, title }` tables, as above,
or as repeated `[[review_item.sub_item]]` tables. A variant's own additive items
may declare them under the same rules. See
[Scoring](/testing/end-to-end/evaluation/#scoring).

## Automated validation

A case can mark a review item as automatically validated: The Test Cabinet
decides the item's verdict from a reporter-side script and synthesizes its media
from the same run. The verdict unit declares a `validation` table naming the
script and the media outputs it produces.

The script's shape follows the run's [engine](/components/core/engines/), and the
two are documented at [Validation](/components/core/validation/):

- Under an **engine**, the script is a **validator** — a `.test.ts` file run by
  vitest **in process**, importing the engine and the build's own modules. A case
  keeps one directory of validators per engine it supports, because a validator
  speaks one engine's vocabulary; the directory for the run's engine is staged
  into the built workspace at `validation/`.
- Under **no engine**, the script drives the case's
  [instrumentation](/testing/end-to-end/instrumentation/) in a browser, against
  the debug API the build installs on the case's `[instrumentation]` handle.

A new case version carries a validator on every review item, with every
threshold derived from the spec. The instrumentation path remains supported for
the versions written against it.

Validation attaches to the graded unit. An item graded as a whole carries it
directly; an item broken into sub-items is verdicted per sub-item, so its
validation lives on each sub-item, one script and one set of proof media per
sub-item. Declaring item-level `validation` alongside `sub_items` is rejected.

```toml
[[review_item]]
id = "ball-spin"
title = "Paddle spin"
text = "Swinging a paddle as the ball contacts it imparts spin."
weight = 2
[[review_item.sub_item]]
id = "stationary"
title = "No spin while stationary"
validation = { script = "validation/ball-spin/stationary.mjs", outputs = [
  { id = "straight", name = "Straight return", kind = "video" },
] }
[[review_item.sub_item]]
id = "moving"
title = "Imparts spin while moving"
validation = { script = "validation/ball-spin/moving.mjs", outputs = [
  { id = "curve", kind = "video" },
] }

# An item with no sub-items is validated as a whole, carrying `validation` itself:
[[review_item]]
id = "scoring-point"
title = "Scoring"
text = "A ball crossing a goal edge increments the correct player's score."
weight = 1
validation = { script = "validation/scoring-point.mjs", outputs = [
  { id = "goal", kind = "video" },
] }
```

- `script` is a path, by convention `validation/<item>.mjs` for a whole-item
  driver and `validation/<item>/<sub>.mjs` for a per-sub-item one, to an ES
  module that default-exports a validation item: an `{ id, arrange, act,
  assert }` object, or a factory returning one. Its `id` names the verdict the
  script backs, the item's own id or the composite `<item>.<sub>`. `arrange`
  poses the scenario through the debug API and `act` runs the behavior under
  test, both required; the optional `assert` records the checks that decide the
  verdict. A debug script is reporter-side and never seeded. Each script may
  drive at most one verdict unit across the whole checklist.
- `outputs` declares the media the script captures, each an `{ id, name, kind }`.
  `name` defaults to a humanized `id`. At least one output is required and output
  ids must be unique within the script. Each output is served under the flat name
  `<verdict>__<output>.<ext>`, where `<verdict>` is the item's id or the
  composite `<item>.<sub>`. The run-scoped actual media and the case-scoped
  baseline media share that name and are told apart by where they are served
  from.

  | `kind` | Extension | Captured by |
  | --- | --- | --- |
  | `image` | `png` | A still the drive screenshots. |
  | `video` | `mp4` | A clip recorded across the drive. |
  | `replay` | `json.gz` | The draw-command [recording](/components/core/engines/#recording) a validator takes off the engine. |

  A recording is a JSON document stored gzipped, which both extensions state. A
  frame names its inherited drawing state and its operations by index into tables
  the whole recording shares, so any frame can be drawn on its own, and what
  repetition remains is what compression removes, taking a real capture down to a
  fraction of its size. A recording is served as
  `application/json` with `Content-Encoding: gzip`, so a console receives the
  JSON document itself.

  A script may declare at most one `video` output, because a browser drive
  records one screen capture per script and there is only one of it. That limit
  does not extend to `replay`: a validator arms and disarms the recorder itself,
  so one suite may hand back a recording per scenario it walks through and each
  is a separate output. A `replay` output belongs to a validator, since the
  recorder is an engine capability a browser drive has no access to.
- Per run, validation runs the script — or the engine's validator suite — against
  the model's build to capture the actual media. The baseline is the same thing
  run against the variant's `reference_implementation` for the same engine, a
  fixed property of the case version, so it is captured once by
  [`tcab capture-baselines`](/components/cli/overview/#commands), committed under
  the version folder at `validation-baseline/<engine>/<variant>/`, and served
  case-scoped. The engine is part of the path because a variant has one reference
  implementation per engine and the two are different builds: a run is only
  comparable against the one it was itself built on. The reviewer sees expected
  and observed media side by side, beside the verdict each backs.
- A `validation` table requires the case to declare an `[instrumentation]`
  handle — the surface the engineless path drives, and the seam a validator poses
  a scenario through under an engine — and may not sit on a graded
  [game-jam](/testing/game-jam/overview/) category, which has no pass/fail to
  decide. Weights and sub-item scoring are
  unchanged: automation pre-decides the same verdicts a human would, in a
  distinguishable color the reviewer can override.

A script that cannot be driven against a conformant build fails the verdict it
backs. The handle being missing, a call throwing, a malformed return, or a
declared output never being produced each count, and the failed verdict is
pre-filled into the review like any other auto verdict and overridable by the
reviewer. See
[load-bearing](/testing/end-to-end/instrumentation/#the-debug-api-is-load-bearing).
A script whose precondition could not be met in the world the model invented
decides nothing, so the point is left for the reviewer. A host with no browser
degrades entirely, exactly as a check does. Which properties a script asserts is
reporter-side detail: the seeded spec states the observable requirement and
mandates the instrument.

## The categories grammar (`format = 2`)

A case authors its checklist in exactly one of two grammars. The
`[[review_item]]` arrays above are one; the alternative, opted into with a
`[review]` table declaring `format = 2`, makes the grouping explicit. Its
top-level entries are bare categories, and every graded point is a review item
under a category. Declaring both a `[review]` table and any `[[review_item]]` is
rejected.

```toml
[review]
format = 2                     # opt into the categories grammar (declared once, here)

[[review.categories]]
id = "spin"                    # groups its items; not itself a verdict id
title = "Spin"                 # the accordion group heading; a category has nothing else
[[review.categories.items]]
id = "stationary"
title = "No spin from a stationary paddle"
description = "A stationary paddle imparts no new spin, so the return stays straight."
weight = 1                     # optional, defaults to 1
validation = { script = "validation/spin/stationary.mjs", outputs = [
  { id = "straight", kind = "video" },
] }
[[review.categories.items]]
id = "decay"
title = "Spin decays"
description = "Imparted spin decays back to straight within a couple of seconds."
```

A category resolves to a review item whose sub-items are its review items, so
scoring, validation, and the reviewer UI treat both grammars identically:

- A category carries only an `id` and a `title`, both non-empty. Prose, weight,
  validation, reference, proof, and domain belong to its items, and declaring
  any of them on a category is rejected. A category must hold at least one item,
  and its weight is the sum of its items' weights.
- A review item is the scored leaf. It carries a non-empty `id` and `title`, an
  optional `description` holding the requirement prose a reviewer reads, an
  optional `weight` defaulting to `1` and greater than zero, optional paired
  `reference` and `proof` media retained for shipped versions, and an optional
  `validation` driver. A declared `description` must be non-empty. Its verdict
  is recorded under the composite id `<category id>.<item id>`, so item ids need
  only be unique within their category. Scoring credits each passed item its own
  weight.
- The `format` is declared once, in the case manifest. A variant file adds its
  own `[[review.categories]]` and inherits the format; it must not use
  `[[review_item]]` or repeat `format`.
- The categories grammar attaches no domain to a point. `[[domain]]` blocks stay
  for the per-domain ratings, and a mode-specific category is simply named so
  the checklist reads by mode. The reviewer UI renders categories as a
  collapsible accordion.

## Errata

Errata record known issues with a version that has already shipped, so a problem
can be acknowledged without cutting a new version. A run is grouped in the
metrics by its exact `(slug, version)`, so a version bump moves every existing
run to a different version and drops it from that version's graphs. An erratum
instead states that an issue is known while the version and its runs stay put.

Errata live in an optional `errata.toml` beside the manifest rather than in
`test-case.toml`. The file is auto-discovered, so it can be added to an
already-reviewed version without touching the reviewed definition. Like the
changelog it is site-facing only and never seeded. Every test type shares this
mechanism.

```toml
# test-cases/<type>/<difficulty>/<folder>/<version>/errata.toml
[[erratum]]
id = "cue-clips-rail"                # stable slug, unique within the version
title = "Cue ball clips the rail at very high speed"
date = "2026-07-17"                  # optional YYYY-MM-DD, shown on the site
severity = "major"                   # info | minor | major (default: minor)
affects_scoring = true               # default false; flags an issue reviewers must weigh
body = """
Above a certain speed the cue ball can tunnel through a rail. Do not penalise a
run for missed collisions at extreme speeds until this is fixed.
"""
resolved_in = "v1.1.0"               # optional; set once a later version fixes it
# variant = "kindle"                 # optional; omit = applies to every variant
# review  = "physics.collisions"     # optional; a review item id or `<item>.<sub-item>`
# exclude_from_score = true          # remove the linked `review` point from scoring
```

- `id` is required, must be non-empty, and must be unique within the file.
- `title` and `body` are required and non-empty. `body` is Markdown, so a TOML
  `"""…"""` string handles multi-line prose.
- `severity` is `info`, `minor`, or `major` and defaults to `minor`. It is a
  badge with no automatic effect on a run's score.
- `affects_scoring` defaults to `false` and marks an issue a reviewer should
  weigh when grading a run of the version. It is the signal that the eventual
  fix would otherwise warrant a version bump.
- `resolved_in` optionally names the version the issue is fixed in. That version
  need not exist yet, since the fix may be planned. A resolved erratum stays
  visible, badged with its fix version.
- `variant` optionally scopes an erratum to a single declared variant. Omitting
  it applies the erratum to every variant.
- `review` optionally ties an erratum to a scored point, so the issue is
  surfaced beside the point it concerns. Its value is a review item id or a
  composite `<item id>.<sub-item id>`, and must name a verdict id that exists in
  the case's checklist.
- `exclude_from_score` defaults to `false` and removes the linked `review` point
  from scoring for the version: the point is still checked, driven, and shown,
  but it no longer contributes to any run's score, and when the point is
  auto-validated a failed drive of it no longer gates the run. It requires a
  `review` link. Reach for it when a review point turns out to be mis-scoring
  runs, so existing runs can be re-scored correctly without the version bump
  that would evict them from the version's metrics.

Errata surface in two places in the console: the case's Errata tab, holding all
of a case's errata grouped by version and newest first, and a "Known errata for
this version" callout on a run's detail view, resolved by the run's version and
variant so a reviewer sees the known issues before scoring.

Because errata live in the same `test-cases/` tree the backend ingests from a
git checkout, publishing them needs no `tcab` release: commit the `errata.toml`
and re-ingest. See [Publish errata](/quickstarts/devops/publish-errata/).
