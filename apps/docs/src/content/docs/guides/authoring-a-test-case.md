---
title: Authoring a Test Case
---

A test case is a single game a model is asked to build, so authoring one is
mostly an exercise in writing a precise, **self-contained specification**. This
guide is the end-to-end procedure. [Test Cases](/components/core/test-cases/) is
the authoritative schema — every manifest field, what is seeded, how templates
render, and the rules enforced at resolution — and you should read it first.
While doing the work, follow the `authoring-a-test-case` skill, which carries the
spec-writing guidance that sits on top of this guide.

The worked example throughout the project is the `pong` case
(`test-cases/pong/v1.0.0/`), whose in-game title is **Carom**. Read its files
alongside this guide; a new case should look like it.

## What a case is, and what gets seeded

A version lives under `test-cases/<slug>/<version>/`. Versioning is per-case and
**immutable**: once a run references a version, that version is frozen, because a
run must always reference an exact, reproducible input. Revise a case by adding a
new version, never by editing a published one. Revisions are expected — both to
refine a case and to vary details between benchmark sweeps so training-data
contamination matters less.

```text
test-cases/<slug>/<version>/
  test-case.toml         # manifest: declares specs, variants, references, checks
  prompt.hbs             # rendered per run into the model's instruction (NOT seeded)
  description.md         # site-facing prose (NOT seeded)
  README.md              # human overview (NOT seeded)
  validation.md          # what the harness checks (NOT seeded)
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

Every case must (see [Design Requirements](/components/core/test-cases/#design-requirements)):

- be **inspired by but not a clone** of an existing game — original name, look,
  and assets;
- need **no API keys** and **no backend** to build, run, or play, because the
  produced game must stay a self-contained static build the gallery can embed;
- be **specifiable precisely enough** that at least one view can be compared
  against a reference automatically;
- either need **no assets** or **pre-provide** them — asset *generation* is not
  what the suite measures.

Pick a catalog **slug** for the lineage (e.g. `pong`) and a separate original
**in-game title** for the build (e.g. `Carom`), then a `version` (`vX.Y.Z`).

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

This is the substance of the work. Two rules dominate:

- **Be self-contained.** A run seeds only the selected variant's specs plus the
  assets, in an isolated container with no access to these docs, the harness, or
  the reference source. The seeded set must be complete and consistent on its
  own: no links outside it, no common spec referencing a variant-only spec, and
  no dependence on the reference **source** mockups (you may point at the seeded
  **screenshots**). See
  [Self-Contained Specifications](/components/core/test-cases/#self-contained-specifications).
- **Be precise and testable.** Every visual detail a model needs — palette,
  layout, measurements, screen contents — must be written into the spec in real
  numbers; the screenshots illustrate the target, they do not replace it. Vague
  prose is the most common failure.

### 4. Write `prompt.hbs`

A short instruction that points the model at the seeded specs and restates the
hard requirements. The template renders in **strict mode**, so use only the
documented variables — `{{workspace}}`, `{{variant.slug}}`/`{{variant.name}}`/
`{{variant.description}}`, and `{{#each specs}}` — and any other reference is a
render error. Keep run-specific detail (container paths, which variant) in the
prompt, never in the specs, which is exactly why the prompt carries `/work` and a
spec never does. See [Prompt template](/components/core/test-cases/#prompt-template).

### 5. Author the reference mockups

Build each view as self-contained static HTML on the fixed logical stage, sharing
a `theme.css` that is the source of truth for the palette and field furniture
(the specs reference the same colors). The harness renders these to screenshots
at the logical viewport, per variant, under the git-ignored
`reference/screenshots/`. Author the **source**; never seed it, and never
hand-create the screenshots.

### 6. Write the manifest and declare variants

Author `test-case.toml` per the [schema](/components/core/test-cases/#manifest):

- **Metadata** — `name`, `difficulty` (`easy`/`medium`/`hard`), and `tags` are
  all required (`tags` may be empty); they are site-facing and have no bearing on
  execution. `description` is an optional site-only path that is never seeded.
- **`[build]`** is required: `install` and `build` commands, stated explicitly
  with no defaults, so a case always records exactly how its implementation is
  built. `npm ci` is conventional because it requires a committed lockfile and
  installs exactly what it pins; the build must emit a static site into `dist/`,
  `build/`, or `out/`.
- **Common `[[spec]]` and `[[reference]]`** lists — seeded for every variant. A
  `.hbs` source is rendered; anything else is seeded verbatim.
- At least one **`[[variant]]`** (the first is the default — usually `base`); see
  [Creating a Test Case Variant](/guides/creating-a-test-case-variant/).
- Any opt-in **`[[check]]`** — reference comparisons are not automatic. A checked
  view's baseline must resolve for **every** variant.

### 7. Write the non-seeded docs

`description.md` (site blurb), `README.md` (human overview, slug-vs-title note),
and `validation.md` (what the harness checks). These never reach a run; keep them
honest about what is seeded.

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
seeded set is self-contained. When the case is ready, exercise it end to end with
[Run a Test Case](/quickstarts/run-a-test-case/).

## Next steps

- [Creating a Test Case Variant](/guides/creating-a-test-case-variant/) — add
  more modes.
- [Reviewing Test Run Results](/guides/reviewing-test-run-results/) — assess a
  run of your case.
