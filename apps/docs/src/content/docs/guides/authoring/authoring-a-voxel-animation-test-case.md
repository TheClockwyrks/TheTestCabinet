---
title: Authoring a Voxel Animation Test Case
---

A **voxel-animation** [asset-generation](/testing/asset-generation/overview/#voxel-models-and-rigs)
test case asks a model to **sculpt and rig a 3D model** out of **opaque `#rrggbb`
voxels** with the `voxel-anim` binary, one recorded operation at a time, toward a goal
**described in a brief**. It is the 3D counterpart of a
[sprite sheet](/guides/authoring/creating-a-sprite-sheet-variant/), but instead of animation
frames the model produces a **rig**: named **parts** in a parent/child hierarchy with
named **joints** (the degrees of freedom) it invents, plus **animations** a consuming
game plays at runtime. As with every asset-generation case there is **no target
model**, and the result is **subjective** — reviewed against the brief. Authoring one is
mostly writing a precise, **self-contained brief** that says what the subject is and how
it must move, and declaring the required animations.

The defining requirement is the **animation contract**. The case's `[model]` table
declares only the set of **required animations** the model must author — each just a
`name`, a `loop` flag, and an `auto_play` flag (a self-playing idle vs. a game-triggered
playable) — the stable, **game-facing interface** a consuming game plays, and the
reviewer's scoring targets. The case does **not** prescribe the parts, joints, pivots,
ranges, or pose angles: the model **invents** the whole skeleton at run time — whatever
parts and joints the subject needs — attaches them where they belong, and authors each
required animation's motion (its F-curves). Working out the right pieces *is the test*.
The produced `rig.json` carries everything, and the validator reconciles that each
required animation exists and actually animates.

Read the authoritative pages first: the
[Voxel binaries](/testing/asset-generation/voxel-binaries/) (the `voxel-anim` operation
set, the required `--part`, the seeded `voxel-anim.config.json`, the per-part isometric
PNG preview, the **assembled multi-view scene** — `scene/{view}.png` — the rig
subcommands, and the F-curve interpolation),
[Manifests](/testing/asset-generation/manifests/#voxel-cases) — the authoritative
schema, whose **Voxel cases** section governs here, including the `[[model.animation]]`
declarations the `[model]` table carries — the
[Overview](/testing/asset-generation/overview/#the-rig-parts-and-joints) (the
opaque-voxel/empty-volume model and how the required animations are the contract while
the parts and joints are the model's to invent), and
[Evaluation](/testing/asset-generation/evaluation/#voxel-validation) (per-part
regeneration and the animation reconciliation — a missing required animation, or one
that never actually animates, is a recorded, zero-scored contract gap). The
[voxel-runtime](/components/voxel-runtime/overview/) is how a produced rig is posed for
the review viewer and real games, so the joint interface the model invents is what a
game will drive and play. This guide is self-contained and is the sole authoring
reference for the voxel-animation kind.

This guide covers the **`voxel-animation`** kind only. For a **static** voxel model use
[Authoring a Voxel Model Test Case](/guides/authoring/authoring-a-voxel-model-test-case/); for a
rigged **meshed** model (the `mc-animation`/`sn-animation`/`dc-animation` CSG kinds) use
[Authoring a Mesh Animation Test Case](/guides/authoring/authoring-a-mesh-animation-test-case/);
for an **organic character** whose skin deforms continuously across its joints use
[Authoring a Skinned Character Test Case](/guides/authoring/authoring-a-skinned-test-case/); for a
**2D** sprite or sprite sheet use
[Authoring an Asset-Generation Test Case](/guides/authoring/authoring-an-asset-generation-test-case/);
for a playable game use
[Authoring an End-to-End Test Case](/guides/authoring/authoring-an-end-to-end-test-case/). To add
a variant to an existing voxel-animation version use
[Creating a Voxel Animation Variant](/guides/authoring/creating-a-voxel-animation-variant/).

The worked example is the `ironward` siege tank — its `[model]` fixes a single required
animation (`turret_sweep`, a game-triggered playable that swivels the gun across its
arc), and the model invents the chassis/turret/barrel parts and the joints that carry
it. Read it alongside this guide — a new case should look like it. For a richer,
multi-animation reference (a `march` walk, a `bombardment`, and a self-playing
`radar_spin`) see the migrated `aegis-mc-anim` case, its meshed sibling kind.

## What a case is, and what gets seeded

A version lives under `test-cases/<type>/<difficulty>/<slug>/<version>/`. Versioning is per-case and
**immutable**: once a run references a version, that version is frozen. Revise by adding
a new version, never by editing a published one.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml          # manifest: type, asset_kind, [voxel], [tool], [output], [model] (required animations), the overall domain
  variants/               # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs              # rendered per run into the model's instruction (NOT seeded)
  description.md          # site-facing prose (NOT seeded)
  README.md               # human overview (NOT seeded)
  specs/
    brief.md              # the brief: what to sculpt, how it must move, how the tool behaves — SEEDED
```

A run receives only the seeded files: the selected variant's brief (the common brief
plus any variant-additive brief), the `voxel-anim` binary on its `PATH` — whose `--help`
is the operations and rig-subcommand contract — and a **pre-seeded `rig.json`** carrying
only the case's required animation declarations (empty tracks the model fills, with
`parts: []` and `joints: []`), so the animation contract exists from t=0. There is **no
target model**, and **no operations schema is seeded**. Everything marked *NOT seeded* is
authoring- or site-side only.

## Procedure

### 1. Choose the subject and the required animations

Pick a **catalog slug** (e.g. `ironward`) and a subject that is naturally
**articulated** — it has distinct, movable components a game would want to see move. The
only thing you fix about the rig is the set of **required animations**. For each motion
the subject must perform, decide:

- a **`name`** a game plays it by (e.g. `march`, `bombardment`, `radar_spin`);
- whether it **`loop`s** — default `true`;
- whether it **`auto_play`s** — `true` for a self-playing idle that runs on its own
  under everything else (a radar sweep, an idle bob), `false` for a game-triggered
  playable (a walk, a recoil).

Do **not** design a parts list, a joint hierarchy, pivots, ranges, or pose angles — the
model **invents** the skeleton the subject needs, attaches it where it belongs, and
animates it, and working that out is the test. Describe in prose what each animation must
**show** (the behaviour), not which joints produce it. Keep the required set to the
motions a game truly needs; the model may add flourish animations on top. Pick a
`version` (`vX.Y.Z`); a version is **immutable** once runs reference it.

### 2. Write the brief

Seed a single self-contained `specs/brief.md`. State:

- **what to sculpt** — the subject, its silhouette and orientation, and the `[voxel]`
  volume framing (which axis is up, which way is forward);
- the **exact palette** — named `#rrggbb` values, the only colors allowed;
- **the subject's key features** — name the components that must read (a hull, legs, a
  main turret, a side turret per flank, a radar vane) and how they relate, but **do not**
  prescribe their exact sizes, positions, pivots, or how to break them into rig parts —
  that is the model's to invent. Note that each part the model defines is sculpted
  **separately** with `voxel-anim --part <name>` in the **shared volume's coordinates**,
  positioned where it sits on the assembled model;
- **how the tool behaves** — `voxel-anim` is the only way to place a voxel and edit the
  rig, `--part` is required on every op, `--help` lists the operations and rig
  subcommands, a sculpting op **only records** (it renders nothing); `voxel-anim render`
  on request draws each part's preview **and the assembled-scene previews**
  (`scene/{iso,front,side,top}.png` — the whole rig composed at rest) and emits the
  geometry, with `render --component <part>` for one part and `render --time <ms>
  --animation <name>` to preview a motion — so the model must render before finishing;
  the volume starts empty, and the recorded operations + `rig.json` are the output;
- **the required animations** — name each animation the model must author and describe
  the **behaviour** it must show in prose (a walk that plants its feet, a turret that
  sweeps its arc), whether it loops, and whether it self-plays or is game-triggered — but
  leave the joints, the period, and the pose angles to the model;
- that the model **may add** its own parts/joints/animations beyond the required set, but
  must **not** drop or contradict the required animations.

The shared **quality directive** — the brief is the floor, not the goal; produce the best
asset you can within its constraints — is prepended to every asset-generation prompt at
render time (`ASSET_QUALITY_PREAMBLE` in `crates/core/src/prompt.rs`), so the brief
itself stays factual and need not restate that "aim high" framing.

### 3. Write `prompt.hbs`

A short instruction pointing the model at the seeded brief, telling it to read `voxel-anim
--help` (operations *and* rig subcommands) and — because a sculpting op **renders
nothing** — to run `voxel-anim render` when it wants to (re)draw each `parts/<part>.png`
**and the assembled-scene previews under `scene/`** (iso/front/side/top) and read them:
the scene is how the model confirms its separately sculpted parts fit together (a part
centered and seated, a child meeting its parent). Restate the hard requirements (sculpt
and rig only through the tool; `--part` on every op; author every required animation;
**run `voxel-anim render` before finishing** so the geometry is emitted; return when
finished). The template renders in **strict mode**, so use only the documented
variables — `{{variant.slug}}` / `{{variant.name}}` / `{{variant.description}}` and
`{{#each specs}}`. Model it on `ironward`'s `prompt.hbs`.

### 4. Write the manifest

Author `test-case.toml` per the [Manifests](/testing/asset-generation/manifests/#voxel-cases)
schema (**Voxel cases**):

- **Metadata** — `slug` (the case's stable identity — the store key and what every run
  records; normally the folder name), `name`, `difficulty`, `tags` (include
  `3d`/`voxel`/`rig`), `summary`, `description`, `prompt`, `max_runtime_hours`.
- **`type = "asset-generation"`** and **`asset_kind = "voxel-animation"`** — required
  (omitting `type` defaults to end-to-end, which then rejects these tables).
- **`[voxel]`** — the fixed `width`/`height`/`depth` and preview `background`. The volume
  starts empty; a voxel case must **not** declare `[canvas]`. **Size the volume from the
  subject's real dimensions at a fixed scale** so relative sizes are comparable across
  cases: pick a plausible real size in metres, then **10 voxels/metre for smaller units**
  (longest side ≤ ~8 m) or **5 voxels/metre for larger units and structures**, with
  proportions that match the subject (a walker is longer than it is wide; a spire is
  tall). Keep the largest resulting dimension roughly in the 40–150 band.
- **`[tool]`** — `binary = "voxel-anim"` and a `preview` path that **must** carry the
  `{part}` token (e.g. `parts/{part}.png`).
- **`[output]`** — an `actions` path that **must** carry the `{part}` token (e.g.
  `parts/{part}.actions.json`); the per-part logs are the authoritative output.
- **`[model]`** — **required for this kind, and it carries ONLY `[[model.animation]]`
  entries.** There are **no** `[[model.part]]` or `[[model.joint]]` tables — the case
  fixes no parts, joints, pivots, ranges, or pose angles; the model **invents** the whole
  skeleton at run time. Each `[[model.animation]]` entry declares just:
  - `name` (string, required) — the identity a game plays the animation by, unique across
    the set;
  - `loop` (bool, default `true`) — loop vs. play once and hold the last pose;
  - `auto_play` (bool, default `false`) — `true` = a self-playing idle that runs on its
    own by default (e.g. a radar spin); `false` = a named playable a game triggers (e.g.
    a walk or a recoil).

  Declare **no `period_ms` and no `joints` list** — the period, the joints, and the
  F-curve keyframes are all the model's to invent at run time (with `define-animation` /
  `add-keyframe`, using `constant`/`linear`/`bezier` interpolation plus
  `ease-in`/`ease-out`/`ease-in-out` presets). The produced animations ride in
  `rig.json`, are exported to glTF for a game to play, and are scored against these
  declarations (a missing required animation, or one that never actually animates, is a
  zero-scored contract gap).
- A **`variants`** list (root key, before the first table) — the first entry the default.
- **No targets** — declare **no `[[reference]]`**; resolution rejects any.
- **`[[domain]]`** — the single `overall` scoring domain, and **no `[[review_item]]`
  checklist** at all. The produced rig is judged as a whole against the brief — it reads
  as the subject from multiple angles, and each required animation reads as its intended
  behaviour (the turret sweeps its arc without detaching, the legs plant and stride, the
  hull stays put) — so the reviewer gives one rating, with the 3D viewer posing the rig
  and playing every produced animation (see
  [Judged on one overall rating](/testing/asset-generation/manifests/#judged-on-one-overall-rating)).
  Say what those animations must look like in the **brief**: it is the only thing the
  rating is given against.

There is **no `[build]` table** and **no `[[check]]`** for this type.

### 5. Write the non-seeded docs

`description.md` (site blurb) and `README.md` (human overview). These never reach a run;
keep them honest about what is seeded.

## Writing the brief

The brief is the test case. The rules that make one good:

- **Be self-contained.** No link outside the seeded set, and no target model; point at the
  binary's `--help` for the operations and rig subcommands.
- **Specify *what*, not *how* — measure creativity, not instruction-following.** Describe
  *what the subject is* (its key features and how they relate) and *how it must move* (the
  required animations and the behaviour each must show); pin only the true requirements —
  the `[voxel]` volume, the exact palette, and the required animation names. Do **not**
  prescribe a parts list, a joint hierarchy, pivots, ranges, exact sizes, coordinates, or
  pose angles: working out the pieces a moving subject needs and where they attach *is the
  test*, and a prescribed skeleton just measures whether the model can follow it.
- **Use precise, testable values for what you DO pin.** Pin the palette to exact
  `#rrggbb`; state the volume framing (which axis is up, which way is forward); name the
  silhouette features that must read and the behaviour each animation must show, e.g. "the
  turret sweeps a full half-turn each way without any voxel of it leaving the hull." Keep
  the features as requirements, not measurements.
- **Describe motion as a requirement in world terms — state *what*, never *how*.** Say what
  the viewer should see and stop there: the barrel elevates up; the feet stay flat on the
  ground and the body advances over them so it reads as a heavy machine pushing itself
  forward, not flailing. Do **not** explain the rig mechanics that achieve it — no
  counter-rotation lessons, digitigrade-knee prescriptions, gait-phasing rules, or segment
  counts — and do **not** link to any walker/design doc: the brief is self-contained, and
  working out the joints and how to keep a foot flat *is the test*. Keep it to the
  behaviour the animation must show. (The
  [walker-rigging doc](/testing/asset-generation/rigging-walkers/) exists to help **you,
  the author**, understand what a convincing walk looks like so you can state that
  requirement crisply — its mechanics never go into the brief.)
- **Keep the required animation set minimal and stable.** A game plays the required
  animations by name — keep them few and well-named (`march`, `bombardment`,
  `radar_spin`). Extra motion belongs in model-added animations, not the required
  contract.
- **Use emphasis sparingly.** Bold a genuine hard constraint (the palette, the volume, a
  required animation name) where it must not be missed — not half the words in a
  paragraph. Prose where everything is bold reads as noise; prefer plain sentences and let
  the few bolded constraints carry weight.
- **Keep the bar high.** Ask for a model that both reads as the subject and animates
  convincingly — the review UI plays the produced animations and poses the rig.

## Validate your work

From the repository root, lint the specs:

```sh
npm run lint:specs   # markdownlint-cli2 + cspell over test-cases/**
```

If `cspell` flags a legitimate domain term, add it to `.cspell/project-words.txt` — do
not reword good prose to dodge the dictionary.

Then render the prompt and seed the repository for **every** variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template and manifest errors — including animation
resolution (each `[[model.animation]]` has a unique `name`, and the `[model]` table
declares **no** parts or joints). `seed` writes the seeded repository to disk (under
`tmp/`) so you can read exactly what the model receives — the brief, the seeded
`voxel-anim.config.json`, and the **pre-seeded `rig.json`** holding only the required
animation declarations (empty tracks the model fills, with `parts: []` and `joints: []`) —
and confirm it is self-contained, with no target model seeded.

### Re-ingest after editing

A backend-driven run resolves its definition from the backend's **immutable def store**,
which skips a version it already holds — and the asset-generation tables (`type`,
`[voxel]`, `[tool]`, `[output]`, `[model]`) are newer fields, so a stale def serves them
empty and the run is mis-typed. After editing a case, **force a re-ingest**:

```sh
curl -X POST http://127.0.0.1:8787/ingest \
  -H 'content-type: application/json' \
  -d '{"testCases": ["<slug>"], "force": true}'
```

Force-re-ingest overwrites the stored version in place — **development only**, while
iterating on an unpublished version. Once a published run references a version it is
**immutable**: revise by creating a **new version** (bump `vX.Y.Z`). See
[Running the services locally](/development/running/).

When the case is ready, exercise it end to end with
[Run a Test Case](/quickstarts/development/run-a-test-case/). Commit on the repository's default
branch with a conventional-commit message scoped to the case (e.g. `feat(<slug>): add
<version> …`). Do not commit `node_modules/` or the rendered local `tmp/` seed output.

## Next steps

- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/) — assess a run of your
  case: the reviewer judges how well the model reads as the subject and how each produced
  animation reads against the required set, with the 3D viewer posing the rig and playing
  the produced animations, then gives the run its one overall rating.
