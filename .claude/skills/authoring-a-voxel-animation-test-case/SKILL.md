---
description: Read this skill before creating a new ANIMATED, rigged voxel asset-generation test case or version (asset_kind = "voxel-animation" — a 3D opaque-RGB model with named parts and joints the model sculpts and rigs with the `voxel-anim` tool, one recorded operation at a time), or when authoring or revising such a case's brief, prompt, `[model]` required animations, or manifest under test-cases/. For a STATIC voxel model use authoring-a-voxel-model-test-case; for a 2D sprite/sprite-sheet use authoring-an-asset-generation-test-case; for a playable game use authoring-an-end-to-end-test-case.
name: authoring-a-voxel-animation-test-case
---

# Authoring a Voxel-Animation (Rigged) Test Case

## What a voxel-animation test case is

A voxel-animation test case asks a model to **sculpt and rig a 3D model** out of
**opaque `#rrggbb` voxels** with the `voxel-anim` binary, one recorded operation at
a time, toward a goal **described in a brief**. It is the 3D counterpart of a
[sprite sheet](../adding-a-sprite-sheet-variant/SKILL.md), but instead of animation
frames the model produces a **rig**: named **parts** in a parent/child hierarchy
with named **joints** (degrees of freedom) it invents, plus **animations** a
consuming game plays at runtime. It does not measure code generation; it measures
how well a model drives the voxel tool and the rig subcommands toward the brief.
There is **no target model**, and the result is **subjective** — reviewed against
the brief.

The defining requirement is the **animation contract**. The case's `[model]` table
declares only the set of **required animations** the model must author — each just a
`name`, a `loop` flag, and an `auto_play` flag (a self-playing idle vs. a
game-triggered playable) — the stable, **game-facing interface** a consuming game
plays, and the reviewer's scoring targets. The case does **not** prescribe the
parts, joints, pivots, ranges, or pose angles: the model **invents** the whole
skeleton at run time — whatever parts and joints the subject needs — attaches them
where they belong, and authors each required animation's motion (its F-curves).
Working out the right pieces *is the test*. The produced `rig.json` carries
everything, and the validator reconciles that each required animation exists and
actually animates. Authoring one is writing a precise, self-contained **brief** that
says WHAT the subject is and HOW it must move, and declaring the required
animations.

The authoritative docs are the source of truth — **read them first** and follow
them as the authority:

- [`testing/asset-generation/overview.md`](../../../apps/docs/src/content/docs/testing/asset-generation/overview.md)
  — what the type measures, the opaque-voxel/empty-volume model, and **The rig:
  parts and joints** (the required animations are the contract; the parts and joints
  are the model's to invent);
- [`testing/asset-generation/voxel-binaries.md`](../../../apps/docs/src/content/docs/testing/asset-generation/voxel-binaries.md)
  — the `voxel-anim` operation set, the required `--part`, the seeded
  `voxel-anim.config.json`, the per-part isometric PNG preview, the **assembled
  multi-view scene** (`scene/{view}.png` — iso/front/side/top), the rig subcommands
  (`define-part`, `set-pivot`, `define-joint`, `define-animation`, `add-keyframe`),
  and the **F-curve** interpolation (`constant`/`linear`/`bezier` +
  `ease-in`/`ease-out`/`ease-in-out`);
- [`testing/asset-generation/manifests.md`](../../../apps/docs/src/content/docs/testing/asset-generation/manifests.md)
  — every manifest field and the rules enforced at resolution (see **Voxel cases**,
  including the `[[model.animation]]` declarations the `[model]` table carries);
- [`testing/asset-generation/evaluation.md`](../../../apps/docs/src/content/docs/testing/asset-generation/evaluation.md)
  — per-part regeneration and the animation reconciliation (a missing required
  animation, or one that never actually animates, is a recorded, zero-scored
  contract gap);
- [`components/voxel-runtime/overview.md`](../../../apps/docs/src/content/docs/components/voxel-runtime/overview.md)
  — how a produced rig is posed for the review viewer and real games (so the joint
  interface the model invents is what a game will drive and play).

This skill covers the **`voxel-animation`** kind only. For a **static** model use
[`authoring-a-voxel-model-test-case`](../authoring-a-voxel-model-test-case/SKILL.md);
for a **2D** sprite/sprite-sheet use
[`authoring-an-asset-generation-test-case`](../authoring-an-asset-generation-test-case/SKILL.md);
for a playable game use
[`authoring-an-end-to-end-test-case`](../authoring-an-end-to-end-test-case/SKILL.md).
To add a variant to an existing voxel-animation version use
[`adding-a-voxel-animation-variant`](../adding-a-voxel-animation-variant/SKILL.md).

The worked example: the `ironward` siege tank — its `[model]` fixes a single
required animation (`turret_sweep`, a game-triggered playable that swivels the gun
across its arc), and the model invents the chassis/turret/barrel parts and the
joints that carry it. Read it alongside this skill — a new case should look like it.
For a richer, multi-animation reference (a `march` walk, a `bombardment`, and a
self-playing `radar_spin`) see the migrated
[`aegis-mc-anim`](../../../test-cases/aegis-mc-anim/v1.0.0/) case.

## Anatomy of a test case version

```text
test-cases/<slug>/<version>/
  test-case.toml          # manifest: type, asset_kind, voxel, tool, output, model (required animations), domains, review items
  variants/               # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs              # rendered per run into the model's instruction (NOT seeded)
  description.md          # site-facing prose (NOT seeded)
  README.md               # human overview (NOT seeded)
  specs/
    brief.md              # the brief: what to sculpt, how it must move, how the tool behaves — SEEDED
```

What a run receives: the selected variant's seeded specs (the common brief + any
variant-additive brief), the `voxel-anim` binary, and a **pre-seeded `rig.json`**
carrying only the case's required animation declarations (empty tracks the model
fills; `parts: []` and `joints: []`), so the animation contract exists from t=0.
There is **no target model**; **no operations schema is seeded** (the binary's
`--help` is the contract).

## Creating a new case — procedure

### 1. Choose the subject and the required animations

Pick a **catalog slug** (e.g. `ironward`) and a subject that is naturally
**articulated** — it has distinct, movable components a game would want to see move.
The only thing you fix about the rig is the set of **required animations**. For each
motion the subject must perform, decide:

- a **`name`** a game plays it by (e.g. `march`, `bombardment`, `radar_spin`);
- whether it **`loop`s** — default `true`;
- whether it **`auto_play`s** — `true` for a self-playing idle that runs on its own
  under everything else (a radar sweep, an idle bob), `false` for a game-triggered
  playable (a walk, a recoil).

Do **not** design a parts list, a joint hierarchy, pivots, ranges, or pose angles —
the model **invents** the skeleton the subject needs, attaches it where it belongs,
and animates it, and working that out is the test. Describe in prose what each
animation must **show** (the behaviour), not which joints produce it. Keep the
required set to the motions a game truly needs; the model may add flourish
animations on top. Pick a `version` (`vX.Y.Z`); a version is **immutable** once runs
reference it.

### 2. Write the brief

Seed a single self-contained `specs/brief.md`. State:

- **what to sculpt** — the subject, its silhouette and orientation, and the
  `[voxel]` volume framing (which axis is up, which way is forward);
- the **exact palette** — named `#rrggbb` values, the only colors allowed;
- **the subject's key features** — name the components that must read (a hull, legs,
  a main turret, a side turret per flank, a radar vane) and how they relate, but
  **do not** prescribe their exact sizes, positions, pivots, or how to break them
  into rig parts — that is the model's to invent. Note that each part the model
  defines is sculpted **separately** with `voxel-anim --part <name>` in the **shared
  volume's coordinates**, positioned where it sits on the assembled model;
- **how the tool behaves** — `voxel-anim` is the only way to place a voxel and edit
  the rig, `--part` is required on every op, `--help` lists the operations and rig
  subcommands, a sculpting op **only records** (it renders nothing); `voxel-anim
  render` on request draws each part's preview **and the assembled-scene previews**
  (`scene/{iso,front,side,top}.png` — the whole rig composed at rest) and emits the
  geometry, with `render --component <part>` for one part and `render --time <ms>
  --animation <name>` to preview a motion — so the model must render before finishing;
  the volume starts empty, and the recorded operations + `rig.json` are the output;
- **the required animations** — name each animation the model must author and
  describe the **behaviour** it must show in prose (a walk that plants its feet, a
  turret that sweeps its arc), whether it loops, and whether it self-plays or is
  game-triggered — but leave the joints, the period, and the pose angles to the
  model;
- that the model **may add** its own parts/joints/animations beyond the required set,
  but must **not** drop or contradict the required animations.

### 3. Write `prompt.hbs`

A short instruction pointing the model at the seeded brief, telling it to read
`voxel-anim --help` (operations *and* rig subcommands) and — because a sculpting op
**renders nothing** — to run `voxel-anim render` when it wants to (re)draw each
`parts/<part>.png` **and the assembled-scene previews under `scene/`**
(iso/front/side/top) and read them — the scene is how the model confirms its
separately sculpted parts fit together (a part centered and seated, a child meeting
its parent). Restate the hard requirements (sculpt/rig only through the tool;
`--part` on every op; author every required animation; **run `voxel-anim render`
before finishing** so the geometry is emitted; return when finished).
Strict mode — only `{{variant.*}}` and `{{#each specs}}`. Model it on `ironward`'s
`prompt.hbs`. A shared **quality directive** (the brief is the floor, not the goal;
produce the best-looking asset you can within its constraints) is prepended to
*every* asset-generation prompt automatically at render time
(`ASSET_QUALITY_PREAMBLE` in `crates/core/src/prompt.rs`), so keep your `prompt.hbs`
factual and do not restate that "aim high" framing yourself.

### 4. Write the manifest

Author `test-case.toml` per the
[manifests schema](../../../apps/docs/src/content/docs/testing/asset-generation/manifests.md)
(**Voxel cases**):

- **Metadata** — `slug` (the case's stable identity — the store key and what every run records; normally the folder name), `name`, `difficulty`, `tags` (include `3d`/`voxel`/`rig`),
  `summary`, `description`, `prompt`, `max_runtime_hours`.
- **`type = "asset-generation"`** and **`asset_kind = "voxel-animation"`** —
  required.
- **`[voxel]`** — the fixed `width`/`height`/`depth` and preview `background`. The
  volume starts empty; a voxel case must **not** declare `[canvas]`. **Size the
  volume from the subject's real dimensions at a fixed scale** so relative sizes are
  comparable across cases: pick a plausible real size in metres, then **10
  voxels/metre for smaller units** (longest side ≤ ~8 m) or **5 voxels/metre for
  larger units and structures**, with proportions that match the subject (a walker
  is longer than it is wide; a spire is tall). Keep the largest resulting dimension
  roughly in the 40–150 band.
- **`[tool]`** — `binary = "voxel-anim"` and a `preview` path that **must** carry
  the `{part}` token (e.g. `parts/{part}.png`).
- **`[output]`** — an `actions` path that **must** carry the `{part}` token (e.g.
  `parts/{part}.actions.json`); the per-part logs are the authoritative output.
- **`[model]`** — **required for this kind, and it carries ONLY `[[model.animation]]`
  entries.** There are **no** `[[model.part]]` or `[[model.joint]]` tables — the case
  fixes no parts, joints, pivots, ranges, or pose angles; the model **invents** the
  whole skeleton at run time. Each `[[model.animation]]` entry declares just:
  - `name` (string, required) — the identity a game plays the animation by, unique
    across the set;
  - `loop` (bool, default `true`) — loop vs. play once and hold the last pose;
  - `auto_play` (bool, default `false`) — `true` = a self-playing idle that runs on
    its own by default (e.g. a radar spin); `false` = a named playable a game
    triggers (e.g. a walk or a recoil).

  Declare **no `period_ms` and no `joints` list** — the period, the joints, and the
  F-curve keyframes are all the model's to invent at run time (with `define-animation`
  / `add-keyframe`, using `constant`/`linear`/`bezier` interpolation plus
  `ease-in`/`ease-out`/`ease-in-out` presets). The produced animations ride in
  `rig.json`, are exported to glTF for a game to play, and are scored against these
  declarations (a missing required animation, or one that never actually animates, is
  a zero-scored contract gap).
- A **`variants`** list (root key, before the first table) — the first entry the
  default.
- **No targets** — declare **no `[[reference]]`**; resolution rejects any.
- **`[[domain]]`** and **`[[review_item]]`** — at least one domain and a checklist
  judging the produced rig against the brief (it reads as the subject from multiple
  angles; each required animation reads as its intended behaviour — the turret sweeps
  its arc without detaching, the legs plant and stride; the hull stays put). An
  item's text can name the **required animations** it judges (e.g. `march`,
  `bombardment`), and the review UI plays the produced animations and poses the rig
  beside the checklist. Each item carries only a `domain` (no `reference`).

There is **no `[build]` table** and **no `[[check]]`** for this type.

### 5. Write the non-seeded docs

`description.md` and `README.md`. These never reach a run.

## Writing the brief

The brief is the test case. The rules that make one good:

- **Be self-contained.** No link outside the seeded set, and no target model; point
  at the binary's `--help` for the operations and rig subcommands.
- **Specify *what*, not *how* — measure creativity, not instruction-following.**
  Describe *what the subject is* (its key features and how they relate) and *how it
  must move* (the required animations and the behaviour each must show); pin only the
  true requirements — the `[voxel]` volume, the exact palette, and the required
  animation names. Do **not** prescribe a parts list, a joint hierarchy, pivots,
  ranges, exact sizes, coordinates, or pose angles: working out the pieces a moving
  subject needs and where they attach *is the test*, and a prescribed skeleton just
  measures whether the model can follow it.
- **Use precise, testable values for what you DO pin.** Pin the palette to exact
  `#rrggbb`; state the volume framing (which axis is up, which way is forward); name
  the silhouette features that must read and the behaviour each animation must show,
  e.g. "the turret sweeps a full half-turn each way without any voxel of it leaving
  the hull." Keep the features as requirements, not measurements.
- **Describe motion as a requirement in world terms — state *what*, never *how*.**
  Say what the viewer should see and stop there: the barrel elevates up; the feet
  stay flat on the ground and the body advances over them so it reads as a heavy
  machine pushing itself forward, not flailing. Do **not** explain the rig mechanics
  that achieve it — no counter-rotation lessons, digitigrade-knee prescriptions,
  gait-phasing rules, or segment counts — and do **not** link to any walker/design
  doc: the brief is self-contained, and working out the joints and how to keep a foot
  flat *is the test*. Keep it to the behaviour the animation must show. (The
  [walker-rigging doc](../../../apps/docs/src/content/docs/testing/asset-generation/rigging-walkers.md)
  exists to help **you, the author**, understand what a convincing walk looks like so
  you can state that requirement crisply — its mechanics never go into the brief.)
- **Keep the required animation set minimal and stable.** A game plays the required
  animations by name — keep them few and well-named (`march`, `bombardment`,
  `radar_spin`). Extra motion belongs in model-added animations, not the required
  contract.
- **Use emphasis sparingly.** Bold a genuine hard constraint (the palette, the
  volume, a required animation name) where it must not be missed — not half the words
  in a paragraph. Prose where everything is bold reads as noise; prefer plain
  sentences and let the few bolded constraints carry weight.
- **Keep the bar high.** Ask for a model that both reads as the subject and animates
  convincingly — the review UI plays the produced animations and poses the rig.

## Validating

From the repository root:

```sh
npm run lint:specs   # markdownlint-cli2 + cspell over test-cases/**
```

- If `cspell` flags a legitimate domain term, add it to
  [`.cspell/project-words.txt`](../../../.cspell/project-words.txt) — do not reword
  good prose to dodge the dictionary.
- Render the prompt and seed the repository for **every** variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template and manifest errors — including animation
resolution (each `[[model.animation]]` has a unique `name`, and the `[model]` table
declares **no** parts or joints). `seed` writes the seeded repository (under `tmp/`)
so you can read what the model receives — the brief, the seeded
`voxel-anim.config.json`, and the **pre-seeded `rig.json`** holding only the required
animation declarations (empty tracks the model fills; `parts: []`, `joints: []`) —
and no target model.

### Re-ingest after editing

A backend-driven run resolves its definition from the backend's **immutable def
store**, which skips a version it already holds — and the asset-generation tables
(`type`, `[voxel]`, `[tool]`, `[output]`, `[model]`) are newer fields, so a stale
def serves them empty and the run is mis-typed. After editing a case, **force a
re-ingest**:

```sh
curl -X POST http://127.0.0.1:8787/ingest \
  -H 'content-type: application/json' \
  -d '{"testCases": ["<slug>"], "force": true}'
```

Force-re-ingest overwrites the stored version in place — **development only**, while
iterating on an unpublished version. Once a published run references a version it is
**immutable**: revise by creating a **new version** (bump `vX.Y.Z`). See
[`development/running.md`](../../../apps/docs/src/content/docs/development/running.md).

Commit on the repository's default branch with a conventional-commit message scoped
to the case (e.g. `feat(<slug>): add <version> …`). Do not commit `node_modules/`
or the rendered local `tmp/` seed output.
