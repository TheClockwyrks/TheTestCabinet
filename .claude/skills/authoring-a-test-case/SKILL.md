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

The authoritative schema for end-to-end cases — what is seeded, how templates
render, the rules enforced at resolution — lives in
[`testing/end-to-end/overview.md`](../../../apps/docs/src/content/docs/testing/end-to-end/overview.md),
and every manifest field is documented in
[`testing/end-to-end/manifests.md`](../../../apps/docs/src/content/docs/testing/end-to-end/manifests.md).
**Read them first.** This skill
is the practical procedure and the spec-writing guidance that sit on top of it;
it does not restate the schema.

There are two [test types](../../../apps/docs/src/content/docs/testing/).
**Most of this skill is the end-to-end procedure** — building a playable game.
An **asset-generation** case is a different shape (the model draws a sprite one
operation at a time instead of building a site); if you are authoring one, read
**[Asset-generation cases](#asset-generation-cases)** below first — it states
what carries over and what differs — then apply only the parts of the end-to-end
procedure it points back to.

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
  test-case.toml         # manifest: specs, variants, references, proofs, checks, review items
  prompt.hbs             # rendered per run into the model's instruction (NOT seeded)
  description.md         # site-facing prose (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/                 # the specification, decomposed by concern — SEEDED
    overview.hbs         #   goals, hard requirements, coordinate system, palette
    playfield.md         #   geometry of the field and its objects
    physics.md           #   simulation, collision, signature mechanic
    flow.md              #   scoring, states, controls, HUD, scope
    modes/standard.md    #   the always-present mode (common)
    modes/<other>.md     #   variant-only mode specs
    proof.md             #   asks the build to capture proof of implementation
  reference/             # mockup SOURCE — rendered to screenshots, NOT seeded
    theme.css            #   shared palette, type, field furniture
    <view>.html          #   one mockup per view (per variant where it differs)
    screenshots/         #   git-ignored; rendered by the harness per variant
  workspaces/            # starter files seeded into the run root — SEEDED (omit if none)
    base/                #   the common workspace (e.g. a package.json to build on)
    <variant>/           #   a per-variant override (replaces base for that variant)
  assets/                # sprites etc. the model must use — SEEDED (omit if none)
```

What a run actually receives: the **selected variant's** workspace starter files
and seeded specs, the case's assets, and the **rendered reference screenshots**.
The case's `init` command then runs in the container to prepare the workspace
(for example installing dependencies). Everything marked *NOT seeded* is
authoring- or site-side only. The prompt is rendered and handed to the
harness as the instruction; it is never written to the run's disk. The reference
**source** is deliberately withheld so a model cannot copy the UI in place of
building it from the spec.

## Asset-generation cases

An asset-generation case asks a model to **draw a small pixel sprite**, one
recorded drawing operation at a time, against a fixed target — not to build a
game. It is a separate [test type](../../../apps/docs/src/content/docs/testing/);
read its docs before authoring one and follow them as the authority:

- [`testing/asset-generation/overview.md`](../../../apps/docs/src/content/docs/testing/asset-generation/overview.md)
  — what the type measures and why the **action log**, not the pixels on disk, is
  the authoritative output;
- [`testing/asset-generation/manifests.md`](../../../apps/docs/src/content/docs/testing/asset-generation/manifests.md)
  — every manifest field;
- [`testing/asset-generation/evaluation.md`](../../../apps/docs/src/content/docs/testing/asset-generation/evaluation.md)
  — how fidelity and cheat-divergence are scored.

The worked examples are `gloamfin` and `lanternjaw`
(`test-cases/gloamfin/v1.0.0/`). Read one alongside the docs — a new asset-gen
case should look like it.

**What carries over from the end-to-end procedure** (apply those steps as
written): choosing a slug/lineage and an immutable `vX.Y.Z` version (step 1); a
short `prompt.hbs` that points at the seeded brief (step 4); the manifest's
site-facing metadata and `[[variant]]` rules (step 6); the non-seeded
`description.md`/`README.md` (step 9); and **Validating** (`npm run lint:specs`,
force-re-ingest after editing, conventional commit).

**What is different:**

- **The manifest, not a `[build]`.** An asset-gen case declares
  `type = "asset-generation"` (required — omitting it defaults to `end-to-end`,
  which rejects the new tables) plus the `[canvas]` (the fixed image to draw on),
  `[tool]` (the `draw` binary, its `operations` schema, and the `preview` path),
  and `[output]` (where the `actions` log is collected) tables. It declares
  **no `[build]` table and no `[[check]]`** — there is no site to build or load,
  so those are rejected for this type. See the manifests doc for the exact shape.
- **One self-contained brief, not a decomposed spec.** Instead of
  `overview`/`playfield`/`physics`/`flow`, seed a single `specs/brief.md` that
  describes *what to draw* (subject, silhouette, palette, framing) and *how the
  tool behaves*. The same self-containment, *what-not-how*, and precise-values
  rules from **Writing specifications** apply — pin the palette and the canvas
  framing in exact terms.
- **Seed the operations schema verbatim.** The `[tool]` `operations` JSON Schema
  is seeded like a spec so the model knows the drawing vocabulary. It must be the
  canonical schema the binary emits — copy it from `draw schema` and keep each
  case's copy **byte-for-byte identical** so it never drifts from the binary.
- **The target is rendered from a `draw` action log, not hand-pixeled.** Author
  the target as its own action log and render it through the same binary
  (`draw render --actions … --out reference/target.png`), keeping the action log
  as the un-seeded source beside it (e.g. `reference/target.actions.json`). This
  guarantees the goal is achievable within the operation set, so fidelity scoring
  is fair. The rendered `target.png` is the single `[[reference]]` (`view =
  "target"`), seeded as the visual goal — there are no per-view reference mockups
  and no `reference/theme.css`.
- **Review items and domains score the drawing.** Declare `[[domain]]`s (e.g.
  `fidelity`) and `[[review_item]]`s that judge how faithfully the regenerated
  sprite matches the target — silhouette, palette, framing — each pairing
  `reference = "target"`. There is no proof-of-implementation step.

## Creating a new case — procedure

### 1. Choose the game and confirm it qualifies

Every case must (see *Design Requirements* in
[`testing/end-to-end/overview.md`](../../../apps/docs/src/content/docs/testing/end-to-end/overview.md)):

- be **inspired by but not a clone of** an existing game — original name, look,
  and assets;
- need **no API keys** and **no backend** to build, run, or play;
- be **specifiable precisely enough** that at least one view can be compared
  against a reference automatically;
- either need **no assets** or **pre-provide** them — an end-to-end case is about
  *building the game*, so it never asks the model to produce art. (Generating an
  asset is its own test type; see [Asset-generation cases](#asset-generation-cases).)

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
[`testing/end-to-end/manifests.md`](../../../apps/docs/src/content/docs/testing/end-to-end/manifests.md): metadata, the common
`[[spec]]` and `[[reference]]` lists, at least one `[[variant]]` (the first is
the default — usually `base`), any opt-in `[[check]]`, the common `[[proof]]`
list (see step 7), and the common `[[review_item]]` list (see step 8). For
additional variants follow [`adding-a-variant`](../adding-a-variant/SKILL.md). A
`.hbs` source is rendered; anything else is seeded verbatim.

### 7. Declare proof of implementation

Decide what evidence the build should submit that its features work, and declare
it two ways that must agree:

- a **`proof.md` spec** (seeded) that tells the build to capture a small set of
  screenshots and/or short `.mp4` clips at fixed paths under `proof/` — framed
  like the references, captured from the built game via the project-local
  Playwright;
- one **`[[proof]]`** per file in the manifest, whose `dest` matches the path in
  `proof.md` exactly. The media kind is inferred from the extension (`.png` image,
  `.mp4` video).

The spec and the `[[proof]]` `dest`s are a single contract — if they drift, the
build writes a file the validator never checks, or vice versa. Validation records
each proof present/missing (informational; never fails the run). Then **pair**
proofs with the checklist: on a `[[review_item]]`, set `reference` to a reference
view (the expected target) and `proof` to a proof id (the submitted media) so the
reviewer compares the two side by side. The two are independent: pair a proof
with a reference whenever a still meaningfully depicts the same screen, but leave
`reference` off when none does — a video proof (a rally or combo clip) whose pace
or timing no still captures stands alone, and the reviewer UI shows it full
width. Don't force a mismatched still onto such a proof, and don't add a
reference *just* to fill the pane. Pong and Coil are the model.

### 8. Declare the reviewer checklist

In the manifest, declare `[[review_item]]`s: the major, observable requirements a
reviewer must explicitly check by playing the build — the signature mechanics and
the easy-to-miss correctness behaviors that validation cannot judge. Each item is
a stable `id`, a short `title` (a few words — the reviewer UI heads the item with
it and a synthesized number), plus the `text` a reviewer reads, and optionally a
`reference`/`proof` pairing (see step 7); a variant adds its own for the mode it
introduces (see [`adding-a-variant`](../adding-a-variant/SKILL.md)). These
are **not seeded** — they restate requirements the seeded specs already state, so
the model never receives the checklist. The reviewer records a verdict for each
before a run can be published. Pong's items are the model; aim for a handful that
capture what a person must verify, not an exhaustive restatement of the spec.

### 9. Write the non-seeded docs

`description.md` (site blurb), `README.md` (human overview, slug-vs-title note),
and `reference/README.md` (the view table). These never reach a run; keep them
honest about what is seeded.

### 10. Validate and commit

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
Specifications* in [`testing/end-to-end/overview.md`](../../../apps/docs/src/content/docs/testing/end-to-end/overview.md).)

### Specify *what*, not *how*

Leave the language, framework, bundler, and rendering approach to the model —
state them as free choices. Pin down **observable behavior and exact values**
instead: what the build must do, look like, and measure. Describe the bounce, not
the function that computes it. The one exception is the build-and-serve
interface, which is fixed for every case — see below.

### Fix the build interface, not the implementation

How a build is *produced and served* is **not** a free choice. The harness
load-check and the per-run Cloudflare Pages deploy both build an implementation the
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

The validator runs the install and build commands from the manifest's required
`[build]` table; both commands must be stated explicitly (there are no defaults).
`npm ci` then `npm run build` is conventional, but a case may pin a different
toolchain (it must still emit a static build into `dist`/`build`/`out`); state the
matching commands in the spec and prompt. Only those commands and
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
npm run lint:specs   # markdownlint-cli2 + cspell over test-cases/**
```

- If `cspell` flags a legitimate domain term, add it to
  [`.cspell/project-words.txt`](../../../.cspell/project-words.txt) — do not
  reword good prose to dodge the dictionary.
- Confirm the manifest resolves: every checked view is supplied by **every**
  variant, all `spec`/`reference` paths exist, and no two seeded specs in one
  variant share a `dest`.

The case's published catalog data (its specs, prompt, and rendered references) is
exported to the public snapshot by the **backend** when a run is ingested — there
is no committed dataset to regenerate and `tcab catalog` only rebuilds the model
catalog, so nothing extra to commit here.

### Re-ingest after editing

The local checkout is only the authoring source; a backend-driven run (the
desktop and web consoles) resolves its definition from the **backend's store**,
not your files. The store skips a version it already holds, so after editing a
case you must **force a re-ingest** for the change to reach a run — otherwise
the backend silently keeps serving the previous definition and any newly added
spec, proof, or prompt edit never reaches the model (a missed re-ingest is the
usual reason a just-authored feature "isn't working"). Against a local
development backend:

```sh
curl -X POST http://127.0.0.1:8787/ingest \
  -H 'content-type: application/json' \
  -d '{"testCases": ["<slug>"], "force": true}'
```

Force-re-ingest overwrites the stored version in place — do this **only during
development**, while iterating on a version no run has been published against.
Once a published run references a version it is **immutable**: revise by
creating a **new version** (bump `vX.Y.Z`), never by editing and re-ingesting
the published one. See
[`testing/end-to-end/overview.md`](../../../apps/docs/src/content/docs/testing/end-to-end/overview.md)
and [`development/running.md`](../../../apps/docs/src/content/docs/development/running.md).
(`tcab validate` reads the local checkout directly, so it is not affected by the
store being stale.)

Commit on the repository's default branch with a conventional-commit message
scoped to the case (e.g. `feat(<slug>): add <version> …`). Do not commit rendered
screenshots (git-ignored) or `node_modules/`.
