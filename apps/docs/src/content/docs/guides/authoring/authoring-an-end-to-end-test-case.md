---
title: Authoring an End-to-End Test Case
---

An [end-to-end](/testing/end-to-end/overview/) test case is a single game a model
is asked to build, so authoring one is mostly an exercise in writing a precise,
**self-contained specification**. This guide is the full procedure.
[End-to-End Tests](/testing/end-to-end/overview/) is the authoritative schema —
every manifest field, what is seeded, how templates render, and the rules
enforced at resolution — and you should read it first. This guide is the
practical procedure and the spec-writing craft that sit on top of it.

Authoring an [asset-generation](/testing/asset-generation/overview/) case — where
the model draws a sprite with a drawing tool rather than building a game — is a
different test type with its own manifest; see
[Authoring an Asset-Generation Test Case](/guides/authoring/authoring-an-asset-generation-test-case/).

The worked example throughout the project is the **Carom** case
(`test-cases/end-to-end/easy/carom/v1.0.0/`). Read its files
alongside this guide; a new case should look like it.

## What a case is, and what gets seeded

A version lives under `test-cases/<type>/<difficulty>/<slug>/<version>/`. Versioning is per-case and
**immutable**: once a run references a version, that version is frozen, because a
run must always reference an exact, reproducible input. Revise a case by adding a
new version, never by editing a published one. Revisions are expected — both to
refine a case and to vary details between benchmark sweeps so training-data
contamination matters less.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: common specs, references, checks, domains, review items
  variants/              # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs             # rendered per run into the model's instruction (NOT seeded)
  description.md         # site-facing prose (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/                 # the specification, decomposed by concern — SEEDED
  reference/             # mockup SOURCE — rendered to screenshots, NOT seeded
  assets/                # sprites etc. the model must use — SEEDED (omit if none)
```

A run receives only the **selected variant's** seeded specs, the case's assets,
and the **rendered reference screenshots**. Everything marked *NOT seeded* is
authoring- or site-side only. The prompt is rendered and handed to the harness as
its instruction; it is never written to the run's disk. The reference **source**
is deliberately withheld so a model cannot copy the UI in place of building it
from the spec.

## Procedure

### 1. Choose the game and confirm it qualifies

Every case must (see [Design Requirements](/testing/end-to-end/overview/#design-requirements)):

- be **inspired by but not a clone** of an existing game — original name, look,
  and assets;
- need **no API keys** and **no backend** to build, run, or play, because the
  produced game must stay a self-contained static build the gallery can embed;
- be **specifiable precisely enough** that at least one view can be compared
  against a reference automatically;
- **mandate the [instrumentation](/testing/end-to-end/instrumentation/)** a run is
  validated through — a debug API on a case-specific global, a deterministic core,
  and a read-only debug overlay — as a hard requirement, framed in the seeded spec
  as an ordinary debugging feature of the game rather than anything to do with
  grading;
- either need **no assets** or **pre-provide** them — an end-to-end case is about
  building the game, never producing its art (generating an asset is its own
  [test type](/testing/asset-generation/overview/)).

Pick an original **in-game title** for the build (e.g. `Carom`); its catalog
**slug** is the kebab-cased title (e.g. `carom`). Then pick a `version` (`vX.Y.Z`).

### 2. Lay the foundations before the detail

In the overview spec, fix the three things every other spec leans on, so the rest
of the specification refers back instead of re-deriving them:

- the **coordinate system** — a fixed logical play area, origin, and axis
  directions;
- the **palette and type** — canonical colors and a system font stack;
- the **states/screens** the build must have.

### 3. Decompose the specification by concern

Split the spec into focused, seeded files that cross-reference each other **by
name**, mirroring Carom: `overview`, `playfield` (geometry), `physics`
(simulation and the signature mechanic), `flow` (scoring, state machine,
controls, HUD, out-of-scope), and one or more **mode** specs under
`specs/modes/`. Common specs are seeded for every variant; mode specs are
typically variant-only.

This is the substance of the work. A few rules dominate:

- **Be self-contained.** A run seeds only the selected variant's specs plus the
  assets, in an isolated container with no access to these docs, the harness, or
  the reference source. The seeded set must be complete and consistent on its
  own: no links outside it, no common spec referencing a variant-only spec, and
  no dependence on the reference **source** mockups (you may point at the seeded
  **screenshots**). See
  [Self-Contained Specifications](/testing/end-to-end/overview/#self-contained-specifications).
- **Specify *what*, not *how*.** Leave the language, framework, bundler, and
  rendering approach to the model — state them as free choices — and pin down
  observable behavior and exact values instead. Describe the bounce, not the
  function that computes it. The test rewards a model that builds the game from
  the spec; a spec that dictates the implementation just measures whether it can
  follow instructions. (The one thing that is *not* a free choice is the
  build-and-serve interface — see step 6.)
- **Be precise and testable.** Every visual detail a model needs — palette,
  layout, measurements, screen contents — must be written into the spec in real
  numbers; the screenshots illustrate the target, they do not replace it. Vague
  prose is the most common failure.
- **Call out the "simple" requirements explicitly.** Models trip over obvious
  things. When a requirement is simple enough that a model *should* get it right
  but a real run still got it wrong, state it as a hard, observable requirement
  rather than leaving it implied — describe the end state to satisfy, still
  without prescribing how.

### 4. Write `prompt.hbs`

A short instruction that tells the model its **task** and points it at the seeded
specs — not a second copy of the specification. State each requirement in **one
place**: the prompt carries the task and the prompt-level, operational detail (the
workspace path, how to verify, how to commit) plus the **fixed build/serve
interface** the harness enforces; the *details* of every other hard requirement
live in the specs, and the prompt points to them rather than restating them. If the
same sentence appears in both the prompt and the overview, cut it from the prompt
and let the spec own it. The template renders in **strict mode**, so use only the
documented variables — `{{workspace}}`, `{{variant.slug}}`/`{{variant.name}}`/
`{{variant.description}}`, and `{{#each specs}}` — and any other reference is a
render error. Keep run-specific detail (container paths, which variant) in the
prompt, never in the specs, which is exactly why the prompt carries `/work` and a
spec never does. See [Prompt template](/testing/end-to-end/overview/#prompt-template).

### 5. Author the reference mockups

Build each view as self-contained static HTML on the fixed logical stage, sharing
a `theme.css` that is the source of truth for the palette and field furniture
(the specs reference the same colors). The harness renders these to screenshots
at the logical viewport, per variant, under the git-ignored
`reference/screenshots/`. Author the **source**; never seed it, and never
hand-create the screenshots.

### 6. Write the manifest and declare variants

Author `test-case.toml` per the [schema](/testing/end-to-end/manifests/):

- **Metadata** — `name`, `difficulty` (`easy`/`medium`/`hard`), and `tags` are
  all required (`tags` may be empty); they are site-facing and have no bearing on
  execution. `description` is an optional site-only path that is never seeded.
- **`[build]`** is required: `install` and `build` commands, stated explicitly
  with no defaults, so a case always records exactly how its implementation is
  built. `npm ci` is conventional because it requires a committed lockfile and
  installs exactly what it pins; the build must emit a static site into `dist/`,
  `build/`, or `out/`. This build-and-serve interface is the one thing that is
  **not** a free choice — the harness load check and the per-run deploy build
  every case the same hardcoded way — so state it as a hard requirement in the
  spec and prompt: a Node project with a root `package.json`, built with only
  Node and npm-installed dependencies, emitting an `index.html` at the root of
  the output directory. Because a finished run is also played back from a
  **per-run sub-path** (`/runs/<id>/build/`), a build that loads files at runtime
  by URL must keep working under any base path (e.g. Vite's `base: './'`); see
  [Design Requirements](/testing/end-to-end/overview/#design-requirements).
- **Common `[[spec]]` and `[[reference]]`** lists — seeded for every variant. A
  `.hbs` source is rendered; anything else is seeded verbatim, and a spec's `dest`
  defaults to its `source` (a trailing `.hbs` stripped), so most specs just name
  their `source`.
- A **`variants`** list — an ordered array of paths to standalone variant files
  under `variants/` (the first is the default; at least one is required). Because
  `variants` is a root key, it must appear **before the first table header**. See
  [Creating an End-to-End Variant](/guides/authoring/creating-an-end-to-end-variant/).
- Any opt-in **`[[check]]`** — reference comparisons are not automatic. A checked
  view's baseline must resolve for **every** variant.
- A common **`[[proof]]`** list — the evidence the build must submit that its
  features work. Declare it two ways that must agree: a seeded `proof.md` spec
  that tells the build to capture screenshots and/or short `.webm` clips (the
  format Playwright records natively) at fixed paths under `proof/`, and one
  `[[proof]]` per file whose `dest` matches that
  path exactly. If the two drift, the build writes a file the validator never
  checks, or vice versa. Proofs are recorded present/missing but never fail a run.
  See [Proofs](/testing/end-to-end/evaluation/#proofs).
- A common **`[[review_item]]`** list — the major, observable requirements a
  reviewer must check by playing the build (a variant adds its own for the mode it
  introduces). These are reporter-side and **not seeded**; the reviewer records a
  verdict for each before a run can be published. An item may **pair** an expected
  `reference` view with the submitted `proof` so the reviewer compares the two
  side by side. See
  [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/#work-the-checklist).

### 7. Write the non-seeded docs

`description.md` (site blurb) and `README.md` (human overview, slug-vs-title
note). These never reach a run; keep them honest about what is seeded.

## Validate your work

There is no separate authoring linter — you validate a case by resolving and
seeding it. For **every** variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` renders the instruction (catching strict-mode template errors and
manifest problems); `seed` writes the seeded repository to disk (under `tmp/` by
default) so you can read exactly what the model would receive and confirm the
seeded set is self-contained. Lint the specs and prose with `npm run lint:specs`
(markdownlint + cspell; see [Building](/development/building/)).

When the case is ready, exercise it end to end with
[Run a Test Case](/quickstarts/development/run-a-test-case/). A backend the case is already
ingested into keeps serving the old definition until you **force a re-ingest**,
so after editing a case re-ingest it before running — see
[Running the Local Service Stack](/guides/development/running-the-local-service-stack/).

## Next steps

- [Instrumentation](/testing/end-to-end/instrumentation/) — the debug API,
  deterministic core, and overlay your case must mandate so a run can be
  validated automatically.
- [Creating an End-to-End Variant](/guides/authoring/creating-an-end-to-end-variant/) — add
  more modes.
- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/) — assess a
  run of your case.
