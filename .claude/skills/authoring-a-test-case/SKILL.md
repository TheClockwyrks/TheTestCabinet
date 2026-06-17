---
description: Read this skill before creating a new test case or version, or when authoring or revising a case's specification, prompt, reference mockups, or manifest under test-cases/. Covers how a test case is structured and how its specs should be written.
name: authoring-a-test-case
---

# Authoring a Test Case

## What a test case is

A test case is a single game a model is asked to build. It is the primary
material The Test Cabinet hands to a model, so authoring one is mostly an
exercise in writing a precise, self-contained **specification**. Cases range
from simple (Pong) to ones that exceed the best current models; they are meant to
stay relevant as models improve, so aim high.

The authoritative schema — every manifest field, what is seeded, how templates
render, the rules enforced at resolution — lives in
[`docs/test-cases.md`](../../../docs/test-cases.md). **Read it first.** This skill
is the practical procedure and the spec-writing guidance that sit on top of it;
it does not restate the schema.

Scope of this skill vs. its sibling:

- **This skill** — creating a *new* test case or version, and authoring or
  revising its specification, prompt, references, and manifest.
- [`adding-a-variant`](../adding-a-variant/SKILL.md) — adding a new variant
  (mode/configuration) to an *existing* version. Its procedure for mode specs,
  per-variant menu mockups, manifest registration, and validation is not
  repeated here; follow it for variant work.

The worked example throughout is the `pong` case (`test-cases/pong/v1.0.0/`),
whose in-game title is **Carom**. Read its files alongside this skill — a new
case should look like it.

## Anatomy of a test case version

```text
test-cases/<slug>/<version>/
  test-case.toml         # manifest: declares specs, variants, references, checks
  prompt.hbs             # rendered per run into the model's instruction (NOT seeded)
  description.md         # site-facing prose (NOT seeded)
  README.md              # human overview (NOT seeded)
  validation.md          # what the harness checks (NOT seeded)
  specs/                 # the specification, decomposed by concern — SEEDED
    overview.hbs         #   goals, hard requirements, coordinate system, palette
    playfield.md         #   geometry of the field and its objects
    physics.md           #   simulation, collision, signature mechanic
    flow.md              #   scoring, states, controls, HUD, scope
    modes/standard.md    #   the always-present mode (common)
    modes/<other>.md     #   variant-only mode specs
  reference/             # mockup SOURCE — rendered to screenshots, NOT seeded
    theme.css            #   shared palette, type, field furniture
    <view>.html          #   one mockup per view (per variant where it differs)
    screenshots/         #   git-ignored; rendered by the harness per variant
  assets/                # sprites etc. the model must use — SEEDED (omit if none)
```

What a run actually receives: the **selected variant's** seeded specs, the
case's assets, and the **rendered reference screenshots**. Everything marked *NOT
seeded* is authoring- or site-side only. The prompt is rendered and handed to the
harness as the instruction; it is never written to the run's disk. The reference
**source** is deliberately withheld so a model cannot copy the UI in place of
building it from the spec.

## Creating a new case — procedure

### 1. Choose the game and confirm it qualifies

Every case must (see *Design Requirements* in
[`docs/test-cases.md`](../../../docs/test-cases.md)):

- be **inspired by but not a clone of** an existing game — original name, look,
  and assets;
- need **no API keys** and **no backend** to build, run, or play;
- be **specifiable precisely enough** that at least one view can be compared
  against a reference automatically;
- either need **no assets** or **pre-provide** them (asset *generation* is not
  what the suite measures).

Pick a **catalog slug** for the lineage (e.g. `pong`) and, separately, an
original **in-game title** for the build (e.g. `Carom`). Pick a `version`
(`vX.Y.Z`); a version is **immutable** once runs reference it — revise by adding
a new version, not by editing a published one.

### 2. Lay the foundations before the detail

Establish, in the overview, the three things every other spec file leans on:

- the **coordinate system** (a fixed logical play area, origin, axis directions);
- the **palette and type** (canonical colors and a system font stack);
- the **states/screens** the build must have.

Decide these once, here, so the rest of the specification can refer back to them
instead of re-deriving them.

### 3. Decompose the specification by concern

Split the spec into focused, seeded files that cross-reference each other **by
name**, mirroring Carom: `overview`, `playfield` (geometry), `physics`
(simulation + signature mechanic), `flow` (scoring, state machine, controls,
HUD, out-of-scope), and one or more **mode** specs under `specs/modes/`. The
common specs are seeded for every variant; mode specs are typically variant-only.
See the spec-writing guidance below — this is the substance of the work.

### 4. Write `prompt.hbs`

A short instruction that points the model at the seeded specs and restates the
hard requirements. Use only the documented template variables (`{{workspace}}`,
`{{variant.*}}`, `{{#each specs}}`) — it renders in strict mode, so any other
reference is an error. Keep run-specific detail (container paths, which variant)
in the prompt, never in the specs. Model it on Carom's `prompt.hbs`.

### 5. Author the reference mockups

Build each view as self-contained static HTML on the fixed logical stage, sharing
a `theme.css` that is the source of truth for the palette and field furniture
(the specs reference the same colors). The harness renders these to screenshots
at the logical viewport, per variant, under the git-ignored
`reference/screenshots/`. Author the **source**; never seed it, never hand-create
the screenshots. See [`reference/README.md`](../../../test-cases/pong/v1.0.0/reference/README.md)
and step 4 of [`adding-a-variant`](../adding-a-variant/SKILL.md).

### 6. Write the manifest and declare variants

Author `test-case.toml` per the schema in
[`docs/test-cases.md`](../../../docs/test-cases.md): metadata, the common
`[[spec]]` and `[[reference]]` lists, at least one `[[variant]]` (the first is
the default — usually `base`), and any opt-in `[[check]]`. For additional
variants follow [`adding-a-variant`](../adding-a-variant/SKILL.md). A `.hbs`
source is rendered; anything else is seeded verbatim.

### 7. Write the non-seeded docs

`description.md` (site blurb), `README.md` (human overview, slug-vs-title note),
`validation.md` (what the harness checks), and `reference/README.md` (the view
table). These never reach a run; keep them honest about what is seeded.

### 8. Validate and commit

See *Validating* below.

## Writing specifications

The specification is the test case. These are the rules that make one good.

### Be self-contained — the rule that catches people

A run seeds only the selected variant's specs plus the case's assets, in an
isolated container with no access to these docs, the harness, or the reference
source. The seeded set must be complete and consistent **on its own**:

- never link to or reference the vision docs, the harness, or any unseeded
  file — every detail the model needs is stated inline;
- a **common** spec must never reference a **variant-only** spec (it ships to
  variants that lack it); a variant spec may reference common specs freely;
- a spec may point at the seeded reference **screenshots**, but never at the
  reference **source**, and the screenshots illustrate the target — they never
  replace prose. Every measurement, color, and screen layout must be written into
  the specification itself.

If you can read a variant's seeded set top to bottom with no dangling reference
and no contradiction, it is well-formed. (Full statement: *Self-Contained
Specifications* in [`docs/test-cases.md`](../../../docs/test-cases.md).)

### Specify *what*, not *how*

Leave the language, framework, bundler, and rendering approach to the model —
state them as free choices. Pin down **observable behavior and exact values**
instead: what the build must do, look like, and measure. Describe the bounce, not
the function that computes it. The one exception is the build-and-serve
interface, which is fixed for every case — see below.

### Fix the build interface, not the implementation

How a build is *produced and served* is **not** a free choice. The harness
load-check and the per-run GitHub Pages deploy both build an implementation the
same hardcoded way, so a build that doesn't match that interface is recorded as
"failed to load" and cannot be deployed — even when it is otherwise correct and
trivially static. Every case must therefore require, as a hard requirement in its
spec and prompt, that the build:

- is a **Node project** with a `package.json` at its root, built with **only
  Node.js and npm-installed dependencies** (no separately installed language
  toolchain — the deploy runner only has Node);
- commits a `package-lock.json` and produces the complete static site by running
  **`npm ci`** (which requires that lockfile) then **`npm run build`**, with no
  other manual step;
- emits that site into one of **`dist/`, `build/`, or `out/`** at the project
  root, with an **`index.html`** at the root of that directory as the entry point;
- runs correctly when that directory is served as-is at the **root** of any static
  file server (it is deployed to static hosting exactly that way, at a domain
  root, so root-relative and relative asset paths both work — no base-path
  handling is needed).

The validator runs the install and build commands from the manifest's `[build]`
table, which defaults to `npm ci` then `npm run build`; declare the table to pin a
different toolchain (it must still emit a static build into `dist`/`build`/`out`),
and state the matching commands in the spec and prompt. Only those commands and
where the output lands are fixed; the language, framework, bundler, and rendering
approach behind the interface stay free. Carom's and Coil's `overview`,
`prompt.hbs`, and `[build]` table are the model wording.

### Use precise, testable numbers

Vague prose is the most common failure. Give pixels, degrees, seconds,
multipliers, and caps, all in the one declared coordinate system — as Carom's
`physics.md` pins the reflection angle, speed multiplier and cap, spin
coefficient, clamp, and decay constant. A number a reviewer or a check can verify
beats an adjective every time.

### Call out the "simple" requirements explicitly

Models trip over obvious things. When a requirement is simple enough that a
model *should* get it right but a real run still got it wrong, state it as a
hard, observable requirement rather than leaving it implied — describe the end
state to satisfy, still without prescribing how. Carom's overview, for example,
does not just say the play area "scales to fit"; it spells out that the
**entire** field — every paddle, the score, every menu item, and all four
edges — must be visible, fitted, and centered at any window size and pixel
density. Prefer adding one unambiguous sentence over assuming the obvious is
obvious.

### Template only when the text must vary

Write specs as plain Markdown, seeded verbatim. Reach for a `.hbs` spec only when
the seeded text genuinely depends on the selected variant or version (so it can
state the build's configuration as fact instead of hedging about what a run "may"
contain). A spec template gets `{{version}}` and `{{variant.*}}` only — not
`{{workspace}}` or the spec list, which belong to the prompt. Its rendered output
must still be self-contained for every variant that renders it.

### Keep the bar high, and don't hide the challenge

Ask for a complete, polished, genuinely playable build, not a tech demo. A case
may ship some tests, but must not hide them from the model or forbid the model
from writing its own — the challenge is the case, never withheld information.

## Validating

From the repository root:

```sh
npm run lint:specs                          # markdownlint-cli2 + cspell over test-cases/**
cargo run --locked -p test-cabinet-cli -- catalog   # regenerate the catalog
```

- If `cspell` flags a legitimate domain term, add it to
  [`.cspell/project-words.txt`](../../../.cspell/project-words.txt) — do not
  reword good prose to dodge the dictionary.
- Confirm the manifest resolves: every checked view is supplied by **every**
  variant, all `spec`/`reference` paths exist, and no two seeded specs in one
  variant share a `dest`.
- The catalog regeneration keeps the committed dataset in sync (the
  `catalog-check` workflow guards it); commit the regenerated output.

Commit on the repository's default branch with a conventional-commit message
scoped to the case (e.g. `feat(<slug>): add <version> …`). Do not commit rendered
screenshots (git-ignored) or `node_modules/`.
