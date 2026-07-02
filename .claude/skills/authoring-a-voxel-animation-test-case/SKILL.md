---
description: Read this skill before creating a new ANIMATED, rigged voxel asset-generation test case or version (asset_kind = "voxel-animation" — a 3D opaque-RGB model with named parts and joints the model sculpts and rigs with the `voxel-anim` tool, one recorded operation at a time), or when authoring or revising such a case's brief, prompt, `[model]` rig, or manifest under test-cases/. For a STATIC voxel model use authoring-a-voxel-model-test-case; for a 2D sprite/sprite-sheet use authoring-an-asset-generation-test-case; for a playable game use authoring-an-end-to-end-test-case.
name: authoring-a-voxel-animation-test-case
---

# Authoring a Voxel-Animation (Rigged) Test Case

## What a voxel-animation test case is

A voxel-animation test case asks a model to **sculpt and rig a 3D model** out of
**opaque `#rrggbb` voxels** with the `voxel-anim` binary, one recorded operation at
a time, toward a goal **described in a brief**. It is the 3D counterpart of a
[sprite sheet](../adding-a-sprite-sheet-variant/SKILL.md), but instead of animation
frames the model produces a **rig**: named **parts** in a parent/child hierarchy
with named **joints** (degrees of freedom) a consuming game can pose at runtime
("rotate the turret to 37°"). It does not measure code generation; it measures how
well a model drives the voxel tool and the rig subcommands toward the brief. There
is **no target model**, and the result is **subjective** — reviewed against the
brief.

The defining requirement is the **rig contract**. The case's `[model]` table
declares the **required** parts and joints — the stable, **game-facing joint
interface** a consuming game drives and the reviewer's scoring targets. At run time
the model may **add** further parts, joints, and auto-play clips of its own; the
produced `rig.json` carries everything, and the validator reconciles it against the
required set. Authoring one is writing a precise, self-contained **brief** *and*
designing the required rig.

The authoritative docs are the source of truth — **read them first** and follow
them as the authority:

- [`testing/asset-generation/overview.md`](../../../apps/docs/src/content/docs/testing/asset-generation/overview.md)
  — what the type measures, the opaque-voxel/empty-volume model, and **The rig:
  parts and joints** (caller-driven vs auto-play; required vs model-added);
- [`testing/asset-generation/voxel-binaries.md`](../../../apps/docs/src/content/docs/testing/asset-generation/voxel-binaries.md)
  — the `voxel-anim` operation set, the required `--part`, the seeded
  `voxel-anim.config.json`, the per-part isometric PNG preview, the **assembled
  multi-view scene** (`scene/{view}.png` — iso/front/side/top), and the rig
  subcommands (`define-part`, `set-pivot`, `define-joint`, `define-clip`);
- [`testing/asset-generation/manifests.md`](../../../apps/docs/src/content/docs/testing/asset-generation/manifests.md)
  — every manifest field and the rules enforced at resolution (see **Voxel cases**,
  including the `[[model.part]]` / `[[model.joint]]` / `[[model.clip]]` tables);
- [`testing/asset-generation/evaluation.md`](../../../apps/docs/src/content/docs/testing/asset-generation/evaluation.md)
  — per-part regeneration, the rig reconciliation (a missing required joint is a
  recorded, zero-scored contract gap), and cheat-divergence per part;
- [`components/voxel-runtime/overview.md`](../../../apps/docs/src/content/docs/components/voxel-runtime/overview.md)
  — how a produced rig is posed for the review viewer and real games (so the joint
  interface you design is what a game will drive).

This skill covers the **`voxel-animation`** kind only. For a **static** model use
[`authoring-a-voxel-model-test-case`](../authoring-a-voxel-model-test-case/SKILL.md);
for a **2D** sprite/sprite-sheet use
[`authoring-an-asset-generation-test-case`](../authoring-an-asset-generation-test-case/SKILL.md);
for a playable game use
[`authoring-an-end-to-end-test-case`](../authoring-an-end-to-end-test-case/SKILL.md).
To add a variant to an existing voxel-animation version use
[`adding-a-voxel-animation-variant`](../adding-a-voxel-animation-variant/SKILL.md).

The worked example: the `ironward` siege tank — a fixed `chassis` root, a `turret`
child that swivels on a **caller-driven `turret_yaw`** joint, and a `barrel` child
of the turret. Read it alongside this skill — a new case should look like it.

## Anatomy of a test case version

```text
test-cases/<slug>/<version>/
  test-case.toml          # manifest: type, asset_kind, voxel, tool, output, model (rig), domains, review items
  variants/               # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs              # rendered per run into the model's instruction (NOT seeded)
  description.md          # site-facing prose (NOT seeded)
  README.md               # human overview (NOT seeded)
  specs/
    brief.md              # the brief: what to sculpt, the parts/joints, how the tool behaves — SEEDED
```

What a run receives: the selected variant's seeded specs (the common brief + any
variant-additive brief), the `voxel-anim` binary, and a **pre-seeded `rig.json`**
containing the case's required parts and joints (so the contract exists from t=0).
There is **no target model**; **no operations schema is seeded** (the binary's
`--help` is the contract).

## Creating a new case — procedure

### 1. Choose the subject and design the rig

Pick a **catalog slug** (e.g. `ironward`) and a subject that is naturally
**articulated** — it has distinct, movable components a game would want to control.
Design the **required rig**:

- **Parts** — name each component and give it a `parent` (the first part is the
  **root**, with no parent) and a **`pivot`** in the **shared volume's coordinates**
  (all parts share one coordinate space): the point the part's joints rotate about,
  **not** a placement offset — parts are sculpted in place where they sit on the
  assembled model. Keep the hierarchy a **tree** (a `turret` on the `chassis`, a
  `barrel` on the `turret`).
- **Joints** — for each degree of freedom a game should drive, declare a joint on a
  part: its `kind` (`rotation` in radians / `translation` in voxels), `axis`,
  `pivot`, `min`/`max`/`rest` range, and `drive`. Make the game-facing controls
  **`drive = "caller"`** (e.g. `turret_yaw`: a rotation about `y` through the
  turret's mount, full `-π..π`, resting at `0`); use **`drive = "auto"`** with a
  `[[model.clip]]` only for motion the *model* should define (idle bob, tread
  scroll).

Keep the **required** rig to the interface a game truly needs — a stable, minimal
contract. The model may add flourish parts/joints on top. Pick a `version`
(`vX.Y.Z`); a version is **immutable** once runs reference it.

### 2. Write the brief

Seed a single self-contained `specs/brief.md`. State:

- **what to sculpt** — the subject, its silhouette and orientation, and the
  `[voxel]` volume framing (which axis is up, which way is forward);
- the **exact palette** — named `#rrggbb` values, the only colors allowed;
- **the required parts** — name each part, what it looks like, and where it attaches
  (its pivot), and that each part is sculpted **separately** with
  `voxel-anim --part <name>` in the **shared volume's coordinates**, positioned
  where it sits on the assembled model (a turret already up on the hull, a barrel
  already out front);
- **the required joints** — name each caller joint, the motion it must produce (e.g.
  the turret swivels left/right about its mount without detaching from the chassis),
  and its range, so the model sculpts the part to move plausibly about that pivot;
- **how the tool behaves** — `voxel-anim` is the only way to place a voxel and edit
  the rig, `--part` is required on every op, `--help` lists the operations and rig
  subcommands, it re-renders each part's isometric preview **and the assembled-scene
  previews** (`scene/{iso,front,side,top}.png` — the whole rig composed at rest) after
  each call, the volume starts empty, and the recorded operations + `rig.json` are the
  output;
- that the model **may add** its own parts/joints/clips beyond the required set, but
  must **not** drop or contradict the required interface.

### 3. Write `prompt.hbs`

A short instruction pointing the model at the seeded brief, telling it to read
`voxel-anim --help` (operations *and* rig subcommands) and to read both each
`parts/<part>.png` **and the assembled-scene previews under `scene/`**
(iso/front/side/top) between calls — the scene is how the model confirms its
separately sculpted parts fit together (a part centered and seated, a child meeting
its parent). Restate the hard requirements (sculpt/rig only through the tool;
`--part` on every op; produce every required part and joint; return when finished).
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

- **Metadata** — `name`, `difficulty`, `tags` (include `3d`/`voxel`/`rig`),
  `summary`, `description`, `prompt`, `max_runtime_hours`.
- **`type = "asset-generation"`** and **`asset_kind = "voxel-animation"`** —
  required.
- **`[voxel]`** — the fixed `width`/`height`/`depth` and preview `background`. The
  volume starts empty; a voxel case must **not** declare `[canvas]`.
- **`[tool]`** — `binary = "voxel-anim"` and a `preview` path that **must** carry
  the `{part}` token (e.g. `parts/{part}.png`).
- **`[output]`** — an `actions` path that **must** carry the `{part}` token (e.g.
  `parts/{part}.actions.json`); the per-part logs are the authoritative output.
- **`[model]`** — **required for this kind.** Declare the required rig:
  - `[[model.part]]` entries — the first is the root (no `parent`); each other names
    a declared `parent`; each carries a `pivot` (`[x, y, z]`). Names unique; parents
    form a tree (no cycles).
  - `[[model.joint]]` entries — each a `name`, a `part` (declared), `kind`, `axis`,
    `pivot`, `min`/`max`/`rest` (with `min <= rest <= max`), and `drive`. A joint may
    also carry an optional **fixed compound mount** — `offset` (a translation in
    voxels) and `orient` (a rotation in radians, Euler X→Y→Z about the pivot) —
    applied in addition to the driven motion, so a component can be attached at a
    custom rotation *and* translation (a joint with `min = max = rest = 0` but a
    non-zero mount is a purely static attach).
  - `[[model.clip]]` entries (optional) — an auto-play timeline for a `drive =
    "auto"` joint: the `joint` it drives, `period_ms`, `loop`, and in-order
    `keyframes` over `[0, period_ms]`. A `caller` joint takes **no** clip.
  - `[[model.animation]]` entries (optional) — **predetermined, case-authored
    animations** the review viewer plays on demand (a play button beside the manual
    joint sliders), so a reviewer can watch the finished rig perform a motion without
    posing it by hand. Each has a unique `name`, a `period_ms`, a `loop` flag, and
    one or more `[[model.animation.track]]` tables — each a declared `joint` plus its
    inline `[t_ms, value]` `keyframes` over `[0, period_ms]`. An animation usually
    drives the rig's **caller** joints and may span several at once (e.g. a
    `turret_sweep` that swings the turret while dipping the barrel). Unlike a clip
    (one `auto` joint the *model* defines), an animation is authored by the *case*,
    is a pure playback aid, and is **not** part of the produced `rig.json`.
- A **`variants`** list (root key, before the first table) — the first entry the
  default.
- **No targets** — declare **no `[[reference]]`**; resolution rejects any.
- **`[[domain]]`** and **`[[review_item]]`** — at least one domain and a checklist
  judging the rig against the brief (the turret swivels on the correct pivot without
  detaching; the chassis stays fixed; the barrel stays attached to the turret; reads
  as the subject from multiple angles). An item may name the caller **joints** it is
  about, so the review UI surfaces that joint's viewer and control beside it. Each
  item carries only a `domain` (no `reference`).

There is **no `[build]` table** and **no `[[check]]`** for this type.

### 5. Write the non-seeded docs

`description.md` and `README.md`. These never reach a run.

## Writing the brief

The brief is the test case. The rules that make one good:

- **Be self-contained.** No link outside the seeded set, and no target model; point
  at the binary's `--help` for the operations and rig subcommands.
- **Specify *what*, not *how*.** Describe the subject, palette, volume framing, the
  required parts and their pivots, and the joint motions; leave the sculpting
  order and technique to the model.
- **Use precise, testable values.** Pin the palette to exact `#rrggbb`; state each
  part's footprint and pivot in voxel coordinates; state each caller joint's axis
  and range. Name what must read from the rig, e.g. "the turret rotates a full
  half-turn each way about its mount without any voxel of it leaving the chassis."
- **Match the rotation-direction convention** when you label a range's ends. The
  runtime poses a **positive pitch (`axis = "x"`) as elevation** — it lifts a
  forward (+z) part **up** toward +y, so `max` aims **high** and `min` aims **low**
  (a `barrel_pitch` of `min = -0.2` depressed → `max = 0.8` lobbing high grows
  upward). Yaw (`y`) and roll (`z`) are right-handed. Don't invert these labels —
  a brief that calls `max` "depressed" contradicts what the model will see.
- **Design a minimal, stable joint interface.** A game will drive the required
  joints by name — keep them few, well-named (`turret_yaw`, `barrel_pitch`), and
  ranged sensibly. Extra motion belongs in model-added parts/joints, not the
  required contract.
- **Keep the bar high.** Ask for a model that both reads as the subject and poses
  correctly — the review UI renders each caller joint as a live control.

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

`prompt` catches strict-mode template and manifest errors — including rig
resolution (unique parts, a single root, parent references with no cycles, joint →
part references, `kind`/`axis`/`drive` parsing, `min <= rest <= max`, and each clip
naming a `drive = "auto"` joint). `seed` writes the seeded repository (under `tmp/`)
so you can read what the model receives — the brief, the seeded
`voxel-anim.config.json`, each part's blank preview, and the **pre-seeded
`rig.json`** holding the required parts and joints — and no target model.

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
