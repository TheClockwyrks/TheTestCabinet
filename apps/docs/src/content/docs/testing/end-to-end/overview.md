---
title: Overview
---

An **end-to-end** test case is a single game that a model is asked to build from
scratch. End-to-end cases range from simple ones such as Pong through to highly
complex ones that require significant assistance from a coding harness for even
the best models to complete. They are intentionally designed to exceed the
capabilities of current state-of-the-art models so that they remain relevant as
models and harnesses improve.

End-to-end is the test type The Test Cabinet was originally built around, and the
only one available today. It evaluates how well a harness and model can take a
large, open-ended task to completion while remaining **fully autonomous**: there
is no human in the loop once a run starts, so the case rewards long-horizon
planning, self-correction, and disciplined use of whatever tooling the harness
provides. The other [test types](/testing/overview/) reuse much of the same
machinery — versioned definitions, immutable publishing, variants — but each
scores something different. This page covers what an end-to-end case contains and
the requirements every one must meet; see [Manifests](/testing/end-to-end/manifests/)
for the `test-case.toml` schema and [Evaluation](/testing/end-to-end/evaluation/)
for how a finished run is scored.

## Catalog Layout

Test cases live in the repository under a top level `test-cases/` folder. Each
test case has its own folder named with a stable slug, and each slug contains
one folder per version:

```
test-cases/<slug>/<version>/
```

Versioning a test case independently allows its design to be revised over time.
Revisions are expected, both to refine a case and to change details between
benchmark runs so that contamination from training data has less impact. Each
version must be self contained so that a run always references an exact,
immutable version.

The repository is the **authoring** source for test cases: a case is written and
revised here. A finished version is then published to the
[backend](/components/backend/overview/), which holds the canonical copy that
[runners](/components/architecture/#runners-and-reporters) resolve at run time.
A runner does not need a checkout of this repository to run a case; it resolves
the requested version from the backend. The on-disk format described here is
exactly what is authored in the repository and what the backend distributes —
publishing a version caches it, it does not transform it.

While a version is still being **authored**, re-ingesting it into a development
backend — a forced overwrite via
[`POST /ingest`](/components/backend/api/#post-ingest) — is the normal way to
see edits take effect, because the store skips versions it already holds. That
overwrite is a **development-only** convenience. Once a run has been
**published** against a version, the version is frozen: its definition must keep
matching every result that references it, so any further change requires a
**new version** (bump `vX.Y.Z`) rather than editing and re-ingesting the
published one.

## Contents

Each test case version must contain:

- A **specification** that describes the game the model must build. This is the
  authoritative spec for the test case and is the primary material handed to the
  model. It may record both high and low level details, including mechanics,
  layouts, states, and rules. The specification should be split across multiple
  seeded files (see [Variants](#variants)) rather than living in a single file.
  Each spec file is either plain Markdown, seeded verbatim, or a Handlebars
  template (`.hbs`) rendered per run with the selected variant; see
  [Spec templates](#spec-templates).
- A **prompt template** (`prompt.hbs`) that is rendered into the instruction
  handed to the harness. See [Prompt template](#prompt-template).
- **Reference visuals** in the form of mockups representative of the UIs that
  must be implemented. Each is rendered to a screenshot that is seeded into the
  run as a visual target for the model; the same screenshot is the baseline for
  any validation check that names the view. The mockup *source* is not seeded.
- **Assets** such as sprites that the model should use, when the case requires
  assets that should not be left to the model to generate.
- **Validation criteria** describing what can be checked automatically. See
  [Evaluation](/testing/end-to-end/evaluation/).

The selected variant's [workspace](#workspace) and specs, the assets, and the
rendered reference screenshots are what gets seeded into a run; the prompt is
rendered and handed to the harness rather than seeded. See [Execution](/components/core/execution/#seeding).

Every version declares these contents in a `test-case.toml` manifest that the
testing harness reads to resolve the version and decide, unambiguously, what is
seeded, which references are rendered, and which checks run. See
[Manifests](/testing/end-to-end/manifests/).

## Prompt template

The instruction handed to the harness is not hard-coded; each version ships a
`prompt.hbs` Handlebars template (named by the manifest's required `prompt`
field) that The Test Cabinet renders into the prompt for a run. Rendering lets a
case word its own instruction while keeping run-specific details — the
in-container paths and the selected variant — out of the authored specifications.
The rendered prompt is handed to the harness; it is **not** seeded to disk. See
[Execution](/components/core/execution/#seeding).

The template is rendered in **strict mode** with HTML escaping disabled (the
output is plain text). Strict mode means referencing any variable other than the
ones below is a render error, rather than silently producing an empty value. The
context exposes exactly:

- `{{workspace}}` — the absolute in-container path of the run workspace, where
  the seeded repository is mounted and the harness builds. This is always `/work`
  and comes from The Test Cabinet, never hardcoded in a spec, so specifications
  stay free of container paths.
- `{{variant.slug}}`, `{{variant.name}}`, and `{{variant.description}}` — the
  selected variant. `description` is empty when the variant declares none.
- `{{#each specs}} … {{/each}}` — the specs seeded for the selected variant, in
  **seed order**: the common specs first, then the variant's own specs. Each
  spec exposes:
  - `{{this.dest}}` — the spec's destination relative to the workspace (for
    example `specs/overview.md`).
  - `{{this.path}}` — the spec's absolute in-container path (for example
    `/work/specs/overview.md`).
  - `{{this.name}}` — the destination file stem (for example `overview`), handy
    for labeling.

Because the absolute paths and variant come from The Test Cabinet at render
time, a specification never needs to mention `/work` or know which variant is
running; the prompt points the model at the seeded files for it.

## Spec templates

A spec is normally plain Markdown, seeded into the run verbatim. A spec whose
`source` ends in `.hbs`, however, is a Handlebars template: The Test Cabinet
renders it at seed time and writes the result to the spec's `dest` (typically a
`.md` file), so the seeded specification states facts that depend on the
selected variant directly — for example naming which configuration this build is
— rather than hedging about what a run "may" contain. The extension on the
`source` decides this: `.hbs` is rendered, anything else is copied as-is.

A spec template is rendered under the same rules as the prompt: **strict mode**
(referencing any variable other than those below is a render error, not a silent
blank) with HTML escaping disabled (a spec is plain text). The context exposes
exactly:

- `{{version}}` — the exact test case version string (for example `v1.0.0`).
- `{{variant.slug}}`, `{{variant.name}}`, and `{{variant.description}}` — the
  selected variant. `description` is empty when the variant declares none.

Unlike the prompt, a spec template is given neither `{{workspace}}` nor the spec
manifest (`{{#each specs}}`): a spec is a file the model reads in place, so
absolute in-container paths and the list of seeded files belong to the prompt,
not the specification. Keeping them out is what lets a spec stay free of
container paths and of any assumption about how the run is laid out — the same
reason the prompt, not the spec, carries `/work`. A spec template's seeded output
must still satisfy [Self-Contained Specifications](#self-contained-specifications)
for whichever variant renders it.

## Workspace

A test case may ship a **workspace**: a directory of starter files seeded into
the **root** of the run before the specs, giving the model a baseline project to
build on rather than a blank repository. It is declared with the top-level
`workspace` key as a path to a directory inside the version folder (for example
`workspaces/base`). Each file under it seeds at its path **relative to the
workspace directory**, so `workspaces/base/package.json` lands at `package.json`
at the run's root and `workspaces/base/src/main.ts` at `src/main.ts`.

A workspace is the idiomatic way to give a case a fixed build interface and any
tooling it needs as **project-local dependencies** rather than relying on tools
preinstalled in the container image. Carom and Coil, for instance, ship a
`package.json` that pins Playwright as a dev dependency, so the in-container
browser tooling a model uses to verify its build is a visible part of its own
project (installed by the case's [init command](#init)) instead of a global a
model has to know is already on the machine.

Workspace files are seeded **verbatim** — unlike specs, they are never rendered
as templates. Hidden entries (names beginning with `.`) are **not** seeded: they
are skipped to match how a version folder is distributed, so a workspace cannot
rely on shipping a dotfile such as `.gitignore`.

Because the workspace, the specs, the assets, and the rendered reference
screenshots are all seeded into the one run tree, **no two of them may land on
the same destination**. A collision — for example a workspace that ships a file
at a spec's `dest`, or under `reference/` — is rejected at resolution rather than
silently clobbering one of them. This is what keeps the workspace integrated with
the spec-seeding step.

A variant may **override** the workspace; see [Variants](#variants).

## Init

A test case may declare a top-level `init` command, run inside the run container
**once the workspace and specs are seeded and mounted, and before the harness
starts**. It is where a case prepares the workspace it shipped — installing its
dependencies or running a setup script — so the model begins against a ready
project. It runs as the container's unprivileged run user with the seeded
repository as its working directory, through a shell (`sh -c`), so it can be a
plain command (`npm install`) or invoke a file the workspace supplies
(`python3 setup.py`). Carom and Coil use
`npm install && npx playwright install chromium` to install the workspace's
dependencies and download the Playwright Chromium build.

The command is bounded by the run's maximum runtime (the same cap as the harness
session), so a hung setup can never run unbounded. A non-zero exit or a timeout
aborts the run before the harness starts and tears the container down — a broken
setup would only waste a harness session — with the captured output surfaced for
diagnosis. `init` is **not** run by `tcab seed`, which only materializes the
seeded files on disk without a container; a real run is where it executes. See
[Execution](/components/core/execution/#init).

## Variants

A test case version offers one or more **variants**, and a run selects exactly
one. The chosen variant is recorded in the run record (see
[Run Records](/components/core/run-records/#subject)), so every result is
attributed to a specific build. At least one `[[variant]]` must be declared.

A variant seeds the case's common specs **plus** its own additional specs, so a
single case can define several builds — for example the same game with or
without an extra mode — without duplicating the shared specification. A
variant's `spec` entries are additive: they layer on top of the common specs
rather than replacing them.

Each spec maps a `source` inside the version folder to a `dest` in the run
workspace, and the `dest` may differ from the `source`. This **dest remapping**
lets a variant present a stable path to the model: variant `frenzy` can seed
`specs/modes/frenzy.md` to `specs/mode.md` while variant `classic` seeds
`specs/modes/classic.md` to the same `specs/mode.md`, so the model always reads
the mode at one predictable location regardless of which variant runs.

Within a single variant the common specs and the variant's own specs must not
map two entries onto the same `dest` — a collision would clobber one of them, so
it is rejected at resolution. (Two *different* variants reusing the same `dest`,
as in the remapping example above, is exactly the point and is allowed.)

### Variant-specific workspace

A variant may declare its own `workspace`, which **replaces** the case's common
workspace for runs of that variant rather than layering on top of it (the way
`spec` and `reference` are additive). This lets a variant ship a different
baseline project — a different `package.json`, configs, or starter files — while
variants that declare none inherit the common workspace. When a variant overrides
the workspace, only its files are seeded for that variant; the common workspace
is not also applied. The same no-collision rule holds for the effective
workspace of each variant (see [Workspace](#workspace)).

### Variant-specific references

A variant may also declare **variant-specific references** through a `reference`
array of `{ view, path }` tables, additive on top of the common `[[reference]]`
views just as `spec` is additive on top of the common specs. This lets a single
view differ per variant — for example a main-menu `title` mockup whose listed
modes change with the variant — while the views that look the same everywhere
stay common. Only the selected variant's references (the common set plus that
variant's own) are rendered and seeded for a run.

A view slug identifies a reference uniquely within a variant's effective set, so
a view declared as a common reference must not also be declared by a variant,
and a variant must not declare the same view twice; either collision is rejected
at resolution. (Different variants each declaring their own reference for the
*same* view slug — the per-variant menu above — is exactly the point and is
allowed.) Because a check's baseline must resolve whichever variant runs, a
checked view must be supplied either commonly or by **every** variant.

### Variant-specific reviewer checklist items

A variant may likewise declare **variant-specific reviewer checklist items**
through a `review_item` array of `{ id, title, text, weight }` tables, additive on top of the
common `[[review_item]]` list just as `spec` and `reference` are additive. This
lets a mode-only requirement be checked only when the variant that adds the mode
runs — for example an item about an extra mode's escalating speed rides along
with that variant alone. An item `id` must be unique within a variant's
effective set (the common items plus that variant's own); a collision is
rejected at resolution.

## Self-Contained Specifications

A test case's specification is seeded into an isolated run container that does
**not** have access to this documentation, the harness, or any part of the test
case other than what is seeded. The specification must therefore be completely
self-contained.

- It must **not** link to or reference this documentation, the harness docs, or
  any other file outside what is seeded with the run. Anything the model needs
  must be stated inline.
- When the specification is split across multiple seeded files, no spec may
  reference a file that the running variant does not seed. A common spec is
  seeded for every variant, so it must **not** reference a variant-only spec
  (for example, a common overview cannot point at a mode spec that only one
  variant seeds); a variant's own specs may reference the common specs, since
  those are always present. The selected variant's seeded set — common specs
  plus that variant's own — must be self-contained on its own.
- It may point at the seeded reference **screenshots** (the rendered visual
  targets), but must **not** depend on the reference **source** mockups, which
  are deliberately not seeded so a model cannot copy them in place of building
  from the spec. Every visual detail a model needs — palette, layout,
  measurements, screen contents — must still be written into the specification
  itself; the screenshots illustrate the target, they do not replace the spec.
- Everything required to build the game must live in the seeded files: the
  selected variant's specs and the test case's assets.

These same constraints apply to a test case's assets, which are seeded alongside
the specification: they must be usable without any file that is not seeded.

## Assets

The goal of The Test Cabinet is to evaluate model capability on large software
development tasks, not asset generation. An end-to-end test case must therefore
either be simple enough that no assets are needed, or it must pre-provide the
assets a model should use. (Generating the assets themselves is the job of an
[asset-generation](/testing/asset-generation/overview/) test case, a separate
test type.)

- Simple cases such as Pong need no assets and may leave all visuals to the
  model.
- More involved cases must provide a set of assets so that each run does not
  have to produce its own, which would make runs less comparable.

## Design Requirements

Every end-to-end test case must satisfy the following:

- It must be **inspired by but not a clone of** the original game. Test cases
  may reuse mechanics from the games that inspire them, but must not recreate
  the original assets, branding, or exact designs. All specifications, reference
  visuals, and assets must be original works produced for The Test Cabinet.
- The final product must **not require API keys**. A visitor must be able to
  play a published implementation without supplying any credentials or incurring
  any cost.
- The final product must **not require backend support**. Every test case must
  be runnable in a browser with no accounts, databases, or other significant
  server side dependencies. This constraint is on the **produced game**, which
  must stay a self-contained static build so it can be embedded and played from
  the public site; it is unrelated to The Test Cabinet's own
  [backend](/components/backend/overview/), which orchestration and publishing use
  but a finished game never touches.
- It must require its implementation to use the **fixed build interface** the
  harness and the per-run deploy both depend on, stated as a hard requirement in
  the spec and prompt. The build must be a Node project with a `package.json` at
  its root, built with only Node.js and npm-installed dependencies (no
  separately installed language toolchain) that commits a `package-lock.json`
  and, by running `npm ci` (which requires that lockfile) then `npm run build`,
  produces the static site into one of `dist/`, `build/`, or `out/` with an
  `index.html` at the root of that directory, runnable served as-is at a server
  root. The load check builds and serves an implementation with the manifest's
  required [`[build]` commands](/testing/end-to-end/manifests/) and records
  anything else as failing to load (see
  [Evaluation](/testing/end-to-end/evaluation/#load-check)); the language,
  framework, bundler, and rendering approach behind the interface remain the
  model's choice.
- It must be possible to **specify visuals precisely enough** that an initial
  automated assessment pass can compare an implementation against the reference
  visuals.

## Provided Tests

A test case may provide some tests as part of its specification. These tests
must not be hidden from the model, and the model must not be blocked from
writing additional tests of its own. The challenge of a test case must come from
the case itself, not from the testing harness withholding information. See
[Execution](/components/core/execution/#model-authored-tests).
