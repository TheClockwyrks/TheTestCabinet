---
title: Overview
---

An end-to-end test case is a single game a model is asked to build from a
written specification. Cases range from small ones such as Carom to ones large
enough that even the best models need substantial help from a coding harness to
finish. They are sized to exceed the capabilities of current models so they stay
relevant as models and harnesses improve.

A run is fully autonomous: no human takes part once it starts, so a case rewards
long-horizon planning, self-correction, and disciplined use of the harness's
tooling. This page covers what a case contains and the requirements every case
must meet. See [Manifests](/testing/end-to-end/manifests/) for the
`test-case.toml` schema and [Evaluation](/testing/end-to-end/evaluation/) for
how a finished run is scored.

## Catalog layout

Test cases live under a top-level `test-cases/` folder, grouped by test type and
difficulty, then by the case's own slug and version:

```
test-cases/<type>/<difficulty>/<slug>/<version>/
```

`<type>` is one of `end-to-end`, `full-stack`, `asset-generation`,
`adversarial`, or `performance`, and `<difficulty>` is one of `easy`, `medium`,
or `hard`. Both grouping levels are organizational. A case's identity, type, and
difficulty come from its `test-case.toml` manifest.

Versioning a case independently allows its design to be revised over time.
Revisions are expected, both to refine a case and to vary details between
benchmark runs so contamination from training data has less impact. Each version
is self-contained, so a run always references an exact, immutable version.

The repository is the authoring source. A finished version is published to the
[backend](/components/backend/overview/), which holds the canonical copy that
runners resolve at run time, so a runner needs no checkout of this repository.
Publishing caches a version rather than transforming it, so the on-disk format
described here is what the backend distributes. While a version is still being
authored, re-ingesting it into a development backend through a forced overwrite
is how edits take effect, because the store skips versions it already holds.

Once a run has been published against a version, the version is frozen: its
definition must keep matching every result that references it, so any further
change requires a new version.

## Contents

Each test case version contains:

- A specification describing the game the model must build. It is the
  authoritative statement of the case and the primary material handed to the
  model, recording mechanics, layouts, states, and rules. Split it across
  several seeded files rather than one. Each spec file is either plain Markdown,
  seeded verbatim, or a Handlebars template rendered per run.
- A prompt template rendered into the instruction handed to the harness.
- Reference views, each seeded as a visual target and usable as the baseline for
  a validation check. A view is either an HTML mockup rendered to a screenshot,
  whose source stays out of the run, or a static image or video served as-is.
- Assets such as sprites, for a case that needs art the model should not have to
  produce.
- Validation criteria describing what is checked automatically. See
  [Evaluation](/testing/end-to-end/evaluation/).
- Instrumentation the build must implement so a run can be driven and inspected
  programmatically. See [Instrumentation](/testing/end-to-end/instrumentation/).

The selected variant's [workspace](#workspace) and specs, the assets, and the
reference media are seeded into the run. The prompt is rendered and handed to
the harness rather than seeded. Every version declares its contents in a
`test-case.toml` manifest, which decides unambiguously what is seeded, which
references are rendered, and which checks run.

## Prompt template

Each version ships a `prompt.hbs` Handlebars template, named by the manifest's
`prompt` field, that The Test Cabinet renders into the prompt for a run.
Rendering lets a case word its own instruction while keeping the in-container
paths and the selected variant out of the authored specifications.

The template is rendered in strict mode with HTML escaping disabled. Strict mode
makes a reference to any variable other than the ones below a render error
rather than a silent blank. The context exposes exactly:

- `{{workspace}}` — the absolute in-container path of the run workspace, where
  the seeded repository is mounted and the harness builds. It comes from The
  Test Cabinet, so specifications stay free of container paths.
- `{{variant.slug}}`, `{{variant.name}}`, and `{{variant.description}}` — the
  selected variant. `description` is empty when the variant declares none.
- `{{time_limit_hours}}` — the run's wall-clock budget in hours, formatted for
  prose, so a prompt can state the limit the model is working against.
- `{{voxel}}` — the effective bounding volume of a voxel
  [asset-generation](/testing/asset-generation/overview/) case, exactly as in
  [Spec templates](#spec-templates). Referencing it on any other case is a
  strict-mode error.
- `{{#each specs}} … {{/each}}` — the specs seeded for the selected variant, in
  seed order: the common specs first, then the variant's own. Each spec exposes
  `{{this.dest}}` (the destination relative to the workspace),
  `{{this.path}}` (the absolute in-container path), and `{{this.name}}` (the
  destination file stem).

## Spec templates

A spec whose `source` ends in `.hbs` is a Handlebars template: The Test Cabinet
renders it at seed time and writes the result to the spec's `dest`. That lets a
seeded specification state facts that depend on the selected variant directly,
such as naming which configuration this build is. Any other source is copied
verbatim.

A spec template renders under the same rules as the prompt, in strict mode with
HTML escaping disabled. Its context exposes exactly:

- `{{version}}` — the exact test case version string, for example `v1.0.0`.
- `{{variant.slug}}`, `{{variant.name}}`, and `{{variant.description}}` — the
  selected variant. `description` is empty when the variant declares none.
- `{{voxel}}` — for a voxel asset-generation case, the effective bounding volume
  for the run: the variant's `[voxel]` override when it declares one, otherwise
  the case's `[voxel]`. It exposes `{{voxel.width}}`, `{{voxel.height}}`, and
  `{{voxel.depth}}` in voxels, plus the highest index on each axis as
  `{{voxel.maxX}}`, `{{voxel.maxY}}`, and `{{voxel.maxZ}}`, so a brief states
  its volume from one source of truth and reads correctly at every size variant.
  Referencing it on any other case is a strict-mode error.

A spec template is given neither `{{workspace}}` nor the spec list. A spec is a
file the model reads in place, so absolute paths and the seeded file list belong
to the prompt. A spec template's rendered output must satisfy
[Self-contained specifications](#self-contained-specifications) for whichever
variant renders it.

## Workspace

A test case may ship a workspace: a directory of starter files seeded into the
root of the run before the specs, giving the model a baseline project to build
on. It is declared with the top-level `workspace` key as a path to a directory
inside the version folder. Each file seeds at its path relative to that
directory, so `workspaces/base/package.json` lands at `package.json` and
`workspaces/base/src/main.ts` at `src/main.ts`.

A workspace is how a case gives itself a fixed build interface and ships its
tooling as project-local dependencies. Carom and Coil ship a `package.json`
pinning Playwright as a dev dependency, so the browser tooling a model verifies
its build with is a visible part of its own project, installed by the case's
[init command](#init).

Workspace files are seeded verbatim; they are never rendered as templates.
Hidden entries are skipped, with two exceptions that are seeded: `.gitignore`
and `.cargo`. A run's implementation is released as a git repository when it is
[published](/components/core/results/), and the `.gitignore` keeps the build
artifacts a run produces out of the public per-run source repository. A case
that builds inside its run tree should ship a `.gitignore` covering its
artifacts.

The workspace, the specs, the assets, and the seeded reference media all land in
the one run tree, so no two of them may claim the same destination. A collision
is rejected at resolution.

A variant may override the workspace; see [Variants](#variants).

## Init

A test case may declare a top-level `init` command, run inside the run container
once the workspace and specs are seeded and mounted, and before the harness
starts. It is where a case prepares the workspace it shipped, so the model
begins against a ready project. It runs as the container's unprivileged run user
with the seeded repository as its working directory, through `sh -c`, so it can
be a plain command such as `npm install` or invoke a file the workspace
supplies. Carom and Coil use `npm install && npx playwright install chromium`.

The command is bounded by the run's maximum runtime, so a hung setup cannot run
unbounded. A non-zero exit or a timeout aborts the run before the harness starts
and tears the container down, with the captured output surfaced for diagnosis.
`init` runs only in a real run; `tcab seed` materializes the seeded files
without a container and reports the command instead of executing it.

## Packages

A test case may declare a list of packages: The Test Cabinet's own
`@test-cabinet/*` runtime libraries, which the build imports as ordinary
dependencies. This exists because some produced assets need a runtime to
interpret them. A [particle](/testing/asset-generation/particle-binaries/)
effect is authored as a `system.json` that a game plays by simulating it live,
and a voxel or mesh rig is posed at runtime. A case that hands a game such an
asset names the in-repo library that already plays it, so the game plays a
produced asset the same way the review UI does.

Declare them with the manifest's `packages` key, naming each package by its npm
name:

```toml
packages = ["@test-cabinet/particle-runtime"]
```

Only the repo's shippable packages may be named: the curated set staged into the
host package store, listed under "The shippable Test Cabinet packages" in
`containers/README.md`. An unknown name is rejected when the case resolves,
before any run is spent.

### The shipped `package.json` declares the dependency

The harness leaves your `package.json` alone. Ship a [workspace](#workspace)
whose `package.json` already declares each named package as an in-repo relative
`file:` dependency under `.tcab/packages/`:

```json
"dependencies": {
  "@test-cabinet/particle-runtime": "file:./.tcab/packages/@test-cabinet/particle-runtime"
}
```

The `packages` key is the declaration resolution checks that file against: every
name must be a shippable package, the case must ship a `package.json`, and that
file must depend on each named package via exactly this `file:` spec, as a
dependency or a dev dependency. Any mismatch is rejected at resolution, before a
run is spent.

### Seeding vendors the library into the run repository

Seeding a `packages`-declaring case copies the requested libraries and their
`@test-cabinet` closure out of the host package store into `.tcab/packages/`
inside the run repository, committed as part of the initial seed commit. Because
the `package.json` above points at that in-repo path, the dependency resolves
wherever the produced tree lives: the run container, the validation host, and
any clone of the [published source repo](/quickstarts/devops/publish-a-run/).
That is what lets a produced game still validate and build after release.

From the build's point of view a declared package is an installed dependency:
the model installs its project as usual and imports the library by its bare name
(`import { ParticleCanvasPlayer } from "@test-cabinet/particle-runtime/canvas"`).
The spec that relies on the package should describe it as a provided dependency
to import rather than as a file path.

A case ships no lockfile, so a `packages` case's [init](#init) command must run
`npm install` or the equivalent. That resolves the `file:` dependency against
the vendored copy and writes it into the lockfile the model then commits, after
which the `[build]` step's `npm ci` reinstalls it reproducibly from that
committed lockfile.

## Variants

A test case version offers one or more variants, and a run selects exactly one.
The chosen variant is recorded in the run record, so every result is attributed
to a specific build.

Each variant lives in its own file, and the top-level `variants` key is an
ordered list of paths to those files, by convention under `variants/`. The first
listed variant is the default, and at least one must be listed. Because
`variants` is a root key, it must appear before the first table header in
`test-case.toml`. A variant file is a self-contained TOML document whose
top-level keys are the variant's fields, and every path inside it resolves
against the version folder.

A variant seeds the case's common specs plus its own additional specs, so one
case can define several builds without duplicating the shared specification. A
variant's `spec` entries layer on top of the common specs rather than replacing
them.

Each spec maps a `source` inside the version folder to a `dest` in the run
workspace, and the two may differ. Remapping the destination lets a variant
present a stable path to the model: variant `frenzy` can seed
`specs/modes/frenzy.md` to `specs/mode.md` while variant `classic` seeds
`specs/modes/classic.md` to the same `specs/mode.md`, so the model always reads
the mode at one predictable location. Within a single variant, the common specs
and the variant's own must not map two entries onto the same `dest`; a collision
is rejected at resolution. Two different variants reusing one `dest`, as above,
is allowed.

### Variant-specific workspace

A variant may declare its own `workspace`, which replaces the case's common
workspace for runs of that variant. Only the variant's files are seeded for that
variant. A variant that declares none inherits the common workspace. The
no-collision rule holds for each variant's effective workspace.

### Variant-specific references

A variant may declare additional references through a `reference` array,
additive on top of the common reference views, so one view can differ per
variant while the views that look the same everywhere stay common. Only the
selected variant's references, the common set plus that variant's own, are
rendered and seeded for a run.

A view slug identifies a reference uniquely within a variant's effective set, so
a view declared commonly must not also be declared by a variant, and a variant
must not declare the same view twice. Different variants each declaring their
own reference for one view slug is allowed. Because a check's baseline must
resolve whichever variant runs, a checked view must be supplied either commonly
or by every variant.

### Variant-specific proofs

A variant may declare additional proofs through a `proof` array, additive on top
of the common proofs. A proof id must be unique within a variant's effective
set, and a proof's `dest` must not collide with a seeded file.

### Variant-specific reviewer checklist items

A variant may declare additional reviewer checklist items, additive on top of
the common ones, in whichever review grammar the case uses. This lets a
mode-only requirement be checked only when the variant that adds the mode runs.
Two entries resolving to the same verdict id within a variant's effective set
are rejected at resolution.

### Variant-specific scoring domains

The case declares its common `[[domain]]` tables in `test-case.toml`; at least
one is required, and every variant is rated on all of them. A variant may
declare additional domains in its own file, so the effective set a reviewer
rates for a run is the common domains plus that run's variant's own. A mode that
only one variant introduces is therefore rated on its own domain rather than
folded into the shared ones. A common review item may name only a common domain;
a variant's own item may name a common domain or one of that variant's own.
Domain ids must be unique across the common domains and any one variant's own.
The run's overall rating is the worst across its effective domains.

## Self-contained specifications

A test case's specification is seeded into an isolated run container with access
to nothing but the seeded files. The specification must therefore be completely
self-contained.

- Everything the model needs must be stated inline. A specification must stand
  on the seeded files alone: the selected variant's specs and the case's assets.
- When the specification is split across several seeded files, each file may
  reference only files the running variant seeds. A common spec is seeded for
  every variant, so it may reference only other common specs; a variant's own
  specs may reference the common ones, which are always present. The selected
  variant's seeded set must be self-contained on its own.
- A specification may point at the seeded reference media, and must still write
  every visual detail the model needs into the specification itself: palette,
  layout, measurements, and screen contents. The reference illustrates the
  target; it does not replace the spec. The source mockup behind a rendered
  reference stays out of the run, so a model builds from the spec rather than
  copying the mockup.

The same constraints apply to a case's assets, which are seeded alongside the
specification and must be usable from the seeded files alone.

## Assets

The Test Cabinet evaluates model capability on large software development tasks,
so an end-to-end case is either simple enough to need no assets, as Carom is, or
pre-provides the assets a model should use, so that runs stay comparable.
Producing assets is the job of an
[asset-generation](/testing/asset-generation/overview/) case, and producing them
alongside a game is the job of a [full-stack](/testing/full-stack/overview/)
case.

## Design requirements

Every end-to-end test case must satisfy the following.

- It must be inspired by rather than a clone of the game behind it. A case may
  reuse mechanics from the games that inspire it, and its specifications,
  reference visuals, and assets must be original works produced for The Test
  Cabinet.
- The final product must run without API keys. A visitor plays a published
  implementation without supplying credentials or incurring cost.
- The final product must run without backend support: a browser, with no
  accounts, databases, or other server-side dependencies. This constrains the
  produced game, which stays a self-contained static build so it can be embedded
  and played from the public site.
- It must require its implementation to use the fixed build interface the
  harness and the per-run deploy depend on, stated as a hard requirement in the
  spec and prompt. The build is a Node project with a `package.json` at its
  root, built with only Node.js and npm-installed dependencies, that commits a
  `package-lock.json` and, by running `npm ci` then `npm run build`, produces a
  static site into one of `dist/`, `build/`, or `out/` with an `index.html` at
  the root of that directory. The load check builds and serves an implementation
  with the manifest's `[build]` commands and records anything else as failing to
  load. The language, framework, bundler, and rendering approach behind the
  interface remain the model's choice.
- It must require page-relative asset URLs whenever the build loads files at
  runtime by URL. The load check and the publish deploy serve at a root, but the
  console plays a finished run back from the per-run sub-path
  `/runs/<id>/build/`, and the host's `<base>`-tag rewrite reaches only the
  served HTML. A URL the build constructs at runtime, or a root-absolute one,
  must therefore be page-relative, so the build runs under any base path. For a
  bundler that means a relative base, such as Vite's `base: './'`.
- It must be possible to specify visuals precisely enough that an automated pass
  can compare an implementation against the reference views.
- It must mandate the instrumentation that lets a run be validated
  automatically: a debug API on a case-specific global, a deterministic core
  beneath it, and a read-only debug overlay. The debug API is a hard
  requirement; a build that does not expose the contract the case declares fails
  the checklist points that contract backs. See
  [Instrumentation](/testing/end-to-end/instrumentation/), and frame it in the
  seeded spec as an ordinary debugging feature of the game.

## Provided tests

A test case may provide tests as part of its specification. Such tests are
visible to the model, and the model is free to write more of its own. A case's
challenge comes from the case itself rather than from information the harness
withholds.
