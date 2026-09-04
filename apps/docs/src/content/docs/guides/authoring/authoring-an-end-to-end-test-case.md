---
title: Authoring an End-to-End Test Case
---

## Overview

An [end-to-end](/testing/end-to-end/overview/) test case is a single game a model
is asked to build from a self-contained specification. This guide is the
procedure. [End-to-End Tests](/testing/end-to-end/overview/) is the authoritative
schema for every manifest field, what is seeded, how templates render, and the
rules enforced at resolution.

The editorial rules for the seeded specs and the prompt live in
[Writing Case Specifications and Prompts](/guides/authoring/writing-case-specifications/).
Read it before writing steps 3 and 4.

The worked example is the Carom case under `test-cases/end-to-end/easy/carom/`.
Read its newest version alongside this guide.

## Case layout

A version lives under `test-cases/<type>/<difficulty>/<slug>/<version>/`.
Versioning is per-case and immutable: once a run references a version, that
version is frozen. Revise a case by adding a new version.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: specs, references, checks, domains, review items
  variants/              # one standalone TOML file per variant (listed in `variants`)
  workspaces/            # one starter project per engine, seeded to the run root
  prompt.hbs             # rendered per run into the model's instruction (NOT seeded)
  description.md         # site-facing prose (NOT seeded)
  changelog.md           # per-version site-facing entry (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/                 # the specification, decomposed by concern (SEEDED)
  references/            # reference implementations, one per engine (NOT seeded)
  showcase/              # per-variant demo media captured from a reference (NOT seeded)
  validation/            # the validators review points are decided by (NOT seeded)
  validation-baseline/   # committed baseline media, per engine and variant
  assets/                # sprites the model must use, SEEDED (omit if none)
```

A run receives the selected variant's seeded specs, the case's assets, and the
workspace for the run's engine; an engine run also receives the vendored
engine and its documentation at `engine/`. The prompt is rendered and handed
to the harness as its instruction; it is never written to the run's disk.

A workspace is one starter project per supported
[engine](/components/core/engines/). An engine's workspace vendors the engine
and the entry stub it requires. The engineless (`none`) workspace provides
configuration only: a `package.json`, tool configuration, and an `index.html`,
with no source code, so the model owns the code it is judged on. See
[Engineless configurations](/guides/authoring/writing-case-specifications/#engineless-configurations).

## Procedure

### 1. Choose the game and confirm it qualifies

Confirm the concept satisfies every
[design requirement](/testing/end-to-end/overview/#design-requirements): inspired
by rather than a clone of an existing game, playable with no API keys and no
backend, specifiable precisely enough that a validator can decide every
review point from the spec, and built through the fixed build interface. The case must
mandate the [instrumentation](/testing/end-to-end/instrumentation/) a run is
validated through, framed in the seeded spec as a debugging feature of the game.

An end-to-end case either needs no assets or pre-provides them. Producing art is
its own [test type](/testing/asset-generation/overview/); a case whose model both
builds the game and produces its art is
[full-stack](/guides/authoring/authoring-a-full-stack-test-case/).

Pick an original in-game title for the build. Its catalog slug is the kebab-cased
title, and its version is a `vX.Y.Z` string.

### 2. Lay the foundations before the detail

In the overview spec, fix the three things every other spec leans on:

- the coordinate system: a fixed logical play area, origin, and axis directions;
- what must be visible on the field and on each screen, leaving palette, type,
  and layout to the build;
- the states and screens the build must have.

### 3. Decompose the specification by concern

Split the spec into focused, seeded files that cross-reference each other by
name. Common specs are seeded for every variant; a mode spec is typically
variant-only and seeded to a stable destination.

A few rules dominate this step.

- Be self-contained. The seeded set must be complete and consistent on its own:
  no links outside it, no common spec referencing a variant-only spec, and no
  dependence on the reference source. See
  [self-contained specs](/testing/end-to-end/overview/#self-contained-specifications).
- Specify what, never how. Pin down observable behavior and exact values, and
  leave how to implement them to the build, per
  [Never help the model](/guides/authoring/writing-case-specifications/#never-help-the-model).
  The seeded workspace fixes the project itself: TypeScript, the build
  interface, and the toolchain commands of step 6. An engine run additionally
  takes rendering, input, and audio from its engine. Within that project the
  architecture and the code are the model's own.
- Be precise and testable. Every behavior a validator checks is written as an
  exact value or an explicit bound, and every validator is derived from the
  spec. Appearance is stated as what must be present. See
  [What is specified and what is validated](/guides/authoring/writing-case-specifications/#what-is-specified-and-what-is-validated).
- State the simple requirements explicitly. When a requirement is one a model
  should get right but a real run got wrong, write it as a hard, observable
  requirement describing the end state to satisfy.

### 4. Write `prompt.hbs`

A short instruction that gives the model its task, points at the seeded specs,
and carries the operational detail: the workspace path, commit expectations, and
the fixed build interface. The template renders in strict mode, and the available
variables are `{{workspace}}`, `{{variant.slug}}`, `{{variant.name}}`,
`{{variant.description}}`, `{{engine.slug}}`, `{{engine.name}}`,
`{{engine.docs}}`, `{{#each specs}}` (each with `dest`, `path`, and `name`),
and `{{time_limit_hours}}`. Any other reference is a render error.

Run-specific detail belongs in the prompt and never in a spec, which is why the
prompt carries `/work` and a spec does not. See
[Prompt template](/testing/end-to-end/overview/#prompt-template).

### 5. Author the reference implementations

Author one correct build per supported engine, by convention under
`references/<engine>/`, and declare the set in each variant's
`[reference_implementation]` table. Each is a complete, conformant
implementation of the variant on that engine: it is built with the case's own
`[build]` commands, passes the same four toolchain gates a run is held to,
and is never seeded into a run.

The reference implementations are what
[`tcab capture-baselines`](/components/cli/overview/#commands) drives to
produce the committed baseline media under
`validation-baseline/<engine>/<variant>/`, what
[`tcab publish-reference`](/components/cli/overview/#commands) deploys for the
case page's Play tab, and what step 7 verifies the validators against.

Reference views (`[[reference]]` mockups and `media`) are retained so shipped
versions keep resolving; a new case declares none.

### 6. Write the manifest and declare variants

Author `test-case.toml` per the [schema](/testing/end-to-end/manifests/).

- Metadata. `slug`, `name`, `difficulty` (`easy`, `medium`, or `hard`), and
  `tags` are required; `tags` may be empty. `changelog` is a required site-only
  path recording what changed in this version, and `description` is an optional
  one; both stay out of the seeded set.
- `[build]` is required and states `install` and `build` explicitly. The
  build emits a static site into `dist/`, `build/`, or `out/` with an
  `index.html` at its root. `npm ci` is conventional because it requires a
  committed lockfile. A finished run is also played back from the per-run
  sub-path `/runs/<id>/build/`, so a build that loads files at runtime by URL
  must keep working under any base path.
- The starter project uses the per-engine spelling: `engines` and `[[engine]]`
  declare the supported engines and the version range each is pinned at, and
  `[workspaces]` names one starter directory per engine. This spelling is what
  makes the version validator-rated. The single `workspace` key is the legacy
  spelling, kept resolving for shipped versions. See
  [The starter project](/testing/end-to-end/manifests/#the-starter-project).
- `[toolchain]` is required of a new version and declares the TypeScript
  commands run over the produced implementation: a gating `typecheck` plus the
  recorded `lint`, `format`, and `test`.
- `variants` is an ordered array of paths to standalone variant files under
  `variants/`. The first is the default, at least one is required, and because it
  is a root key it must appear before the first table header. See
  [Creating an End-to-End Variant](/guides/authoring/creating-an-end-to-end-variant/).
- Common `[[spec]]` entries are seeded for every variant. A `.hbs` source is
  rendered; anything else is seeded verbatim. A spec's `dest` defaults to its
  `source` with a trailing `.hbs` stripped.
- `[[reference]]`, `[[check]]`, and `[[proof]]` are retained so shipped
  versions keep resolving; a new case declares none. The media a reviewer
  compares is captured by the case's validators from scenarios the case
  controls.
- `[instrumentation]` declares the debug-API handle the build installs its
  automation surface on. It is required because every review point declares a
  `validation` script.
- The checklist uses exactly one of two grammars. The categories grammar
  (`[review]` with `format = 2` and `[[review.categories]]`) groups each graded
  point under a named category; the top-level `[[review_item]]` arrays are the
  alternative. Each point is one observable behavior, stated in the spec exactly
  or by explicit bounds, and carries a `validation` script under
  `validation/<engine>/` for each engine it covers, which is every engine the
  case supports unless the validation's `engines` key names fewer. A case on the
  engine format is
  [validator-rated](/testing/end-to-end/evaluation/#rating-channels), so each
  point also declares the `domains` its failure lowers and a `failure_cap`, the
  best functional rating those domains keep while it fails: `broken` for a
  gameplay-critical requirement, otherwise `scuffed`, `passable`, or `great`. A
  point may pair an expected `reference` view with a submitted `proof`.
  Checklist entries are reporter-side and stay out of the seeded set.
- `[[domain]]` entries are the scoring domains. The validators rate each on the
  functional scale through the failure caps, and the run's functional rating is
  the worst across the effective set. A reviewer rates the run's aesthetics as
  a whole: how the build looks, sounds, and feels to play.

### 7. Author the validators and capture baselines

Every graded point carries a `validation` script, shipped under
`validation/<engine>/` with the script path relative to that directory, for each
engine it covers. Give a point an `engines` list to scope it to the engines
where the behavior is the model's own work; omitting the key covers every
supported engine. Design the suites per
[Writing Debug APIs and Validators](/guides/authoring/writing-debug-apis-and-validators/):
one requirement per validator, every assertion traced to the spec, scenarios
posed through the shared harness and the debug API.

Run each engine's suite against that engine's reference implementation with
`tcab validate`, which exits `0` only when every declared point held; a validator
that fails there is a broken validator, not a failing build. Then confirm each
validator discriminates by breaking the rule it covers in a scratch copy of the
reference and confirming exactly the expected check fails. When the suites pass, run
[`tcab capture-baselines`](/components/cli/overview/#commands) and commit the
media it writes under `validation-baseline/<engine>/<variant>/`.

### 8. Write the non-seeded docs

`description.md` (site blurb), `changelog.md` (what changed in this version), and
`README.md` (human overview). These never reach a run.

## Validate your work

A case is validated by resolving and seeding it. For every variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant> --engine <engine>
tcab seed   --test-case <slug> --version <version> --variant <variant> --engine <engine>
```

`prompt` renders the instruction, catching strict-mode template errors and
manifest problems. `seed` writes the seeded repository to disk (under `tmp/` by
default) so you can read exactly what the model would receive and confirm the
seeded set is self-contained.

Repeat both for every engine the case supports; `--engine` defaults to
`none`. Each engine renders its own branch of the spec templates, so every
combination is read against the seeded output rather than the sources.

Lint the specs and prose from the repository root:

```sh
npm run lint:specs   # markdownlint-cli2 + cspell
```

If `cspell` flags a legitimate domain term, add it to
`.cspell/project-words.txt`.

When the case is ready, exercise it with
[Run a Test Case](/quickstarts/development/run-a-test-case/). A backend that
already holds the version keeps serving it until a forced re-ingest, so re-ingest
an edited case before running it. See
[Running the Local Service Stack](/guides/development/running-the-local-service-stack/).

## Next steps

- [Specs and prompts](/guides/authoring/writing-case-specifications/) gives the
  editorial rules and the revision checklist for the seeded set.
- [Instrumentation](/testing/end-to-end/instrumentation/) covers the debug API,
  deterministic core, and overlay your case must mandate.
- [Writing Debug APIs and Validators](/guides/authoring/writing-debug-apis-and-validators/)
  gives the design rules for that API and the validators that drive it.
- [Creating an End-to-End Variant](/guides/authoring/creating-an-end-to-end-variant/)
  adds more modes.
- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/)
  assesses a run of your case.
