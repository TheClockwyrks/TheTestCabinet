---
description: Read this skill before creating a new ANIMATED, rigged meshed asset-generation test case or version (asset_kind = "mc-animation", "sn-animation", or "dc-animation" — a 3D model with named parts and joints the model sculpts as per-part signed-distance fields with the `mc-anim`/`sn-anim`/`dc-anim` meshing binary and rigs with F-curve animations, one recorded operation at a time), or when authoring or revising such a case's brief, prompt, `[model]` rig, or manifest under test-cases/. For a STATIC meshed model use authoring-a-mesh-model-test-case; for a rigged VOXEL (cube) model use authoring-a-voxel-animation-test-case; for a 2D sprite/sprite-sheet use authoring-an-asset-generation-test-case; for a playable game use authoring-an-end-to-end-test-case.
name: authoring-a-mesh-animation-test-case
---

# Authoring a Meshed-Animation (Rigged) Test Case

## What a mesh-animation test case is

A mesh-animation test case asks a model to **sculpt and rig a 3D model** by
**compositing signed-distance fields** — a CSG paradigm — with a **meshing binary**,
one recorded operation at a time, toward a goal **described in a brief**; the binary
extracts a triangle mesh **per part**. It is the surface-extraction sibling of the
[voxel animation](../authoring-a-voxel-animation-test-case/SKILL.md): instead of a
single field, the model produces a **rig** — named **parts** in a parent/child
hierarchy, each an **independently-authored field** meshed on its own, with named
**joints** (degrees of freedom) and **model-authored animations** a consuming game
poses and plays at runtime. It does not measure code generation; it measures how
well a model drives the meshing tool and the rig subcommands toward the brief. There
is **no target model**, and the result is **subjective** — reviewed against the
brief.

This skill covers the **three animated meshed kinds** together — `mc-animation`,
`sn-animation`, `dc-animation` — because they share the **same authoring workflow**
(author per-part SDF/CSG fields toward a brief, plus the rig) and differ only in
**which `-anim` binary the case names** and its resulting **surface character**:

| `asset_kind` | binary | character |
| --- | --- | --- |
| `mc-animation` | `mc-anim` (Marching Cubes) | **bold low poly** — chunky, faceted, coarse grid |
| `sn-animation` | `sn-anim` (Surface Nets) | **smooth mid-fidelity** — rounded, watertight, uniform |
| `dc-animation` | `dc-anim` (Dual Contouring) | **crisp / sharp** — preserves sharp edges and corners |

The character is a **fixed property of the binary**, not a manifest knob. Only Dual
Contouring adds a per-primitive **`--sharp` / `--smooth`** tag; `mc-anim`/`sn-anim`
do not expose it.

**The rig mechanics are identical to a voxel animation.** The parts/joints/F-curve
animation model — the `define-part` / `set-pivot` / `define-joint` /
`define-animation` / `add-keyframe` subcommands, the `constant`/`linear`/`bezier`
interpolation plus the `ease-in`/`ease-out`/`ease-in-out` presets, the rotation-sign
convention, and the `caller`-vs-`auto` joint drives — is **shared with `voxel-anim`
and not re-documented for the meshers**. This skill teaches the field authoring that
is new (CSG/SDF instead of cubes) and **references** the voxel-animation skill for
the rig; read
[`authoring-a-voxel-animation-test-case`](../authoring-a-voxel-animation-test-case/SKILL.md)
for the rig-design details rather than duplicating them here.

The defining requirement is the **rig contract**. The case's `[model]` table
declares the **required** parts, joints, and **animation declarations** — the
stable, **game-facing interface** a consuming game drives and plays, and the
reviewer's scoring targets. At run time the model **authors** each required
animation's motion (the F-curve keyframes) and may **add** further parts, joints,
and animations of its own; the produced `rig.json` carries everything, and the
validator reconciles it against the required set. Authoring one is writing a
precise, self-contained **brief** *and* designing the required rig.

The authoritative docs are the source of truth — **read them first** and follow
them as the authority:

- [`testing/asset-generation/overview.md`](../../../apps/docs/src/content/docs/testing/asset-generation/overview.md)
  — what the type measures, the meshed-voxel-model paradigm, and **The rig: parts,
  joints, and animations** (caller-driven vs `auto`; required vs model-added);
- [`testing/asset-generation/mesh-binaries.md`](../../../apps/docs/src/content/docs/testing/asset-generation/mesh-binaries.md)
  — the `mc-anim`/`sn-anim`/`dc-anim` interface: the continuous **signed-distance
  field**, the shared **CSG vocabulary** (`add-*`/`subtract-*`, `--blend`, `mirror`/
  `translate`/`copy`/`replace-color`/`clear`), the **DC-only `--sharp`** tag, the
  required per-op **`--part <name>`** (one field, log, preview, and `mesh.json` per
  part), and **"The animated binaries: one field per part, plus the rig"** — which
  states the rig model is **identical to `voxel-anim`**;
- [`testing/asset-generation/voxel-binaries.md`](../../../apps/docs/src/content/docs/testing/asset-generation/voxel-binaries.md)
  — the shared **rig subcommands** and **F-curve** interpolation the mesh docs point
  back to (`define-part` / `set-pivot` / `define-joint` / `define-animation` /
  `add-keyframe`; `constant`/`linear`/`bezier` + the ease presets);
- [`testing/asset-generation/rigging-walkers.md`](../../../apps/docs/src/content/docs/testing/asset-generation/rigging-walkers.md)
  — the design guidance for legged rigs and walk cycles (shared with voxel walkers);
- [`testing/asset-generation/manifests.md`](../../../apps/docs/src/content/docs/testing/asset-generation/manifests.md)
  — every manifest field and the rules enforced at resolution (see **Voxel cases**,
  including the meshed `[tool].binary`, the `[output]` op log, and the
  `[[model.part]]` / `[[model.joint]]` / `[[model.animation]]` tables);
- [`testing/asset-generation/evaluation.md`](../../../apps/docs/src/content/docs/testing/asset-generation/evaluation.md)
  — per-part review, the rig reconciliation (a missing required joint or animation is
  a recorded, zero-scored contract gap);
- [`components/voxel-runtime/overview.md`](../../../apps/docs/src/content/docs/components/voxel-runtime/overview.md)
  — how a produced rig's per-part `mesh.json` is posed for the review viewer and real
  games (so the joint interface you design is what a game will drive).

This skill covers the **animated** meshed kinds only. For a **static** meshed model
use
[`authoring-a-mesh-model-test-case`](../authoring-a-mesh-model-test-case/SKILL.md);
for a **rigged VOXEL (cube)** model use
[`authoring-a-voxel-animation-test-case`](../authoring-a-voxel-animation-test-case/SKILL.md);
for a **2D** sprite/sprite-sheet use
[`authoring-an-asset-generation-test-case`](../authoring-an-asset-generation-test-case/SKILL.md);
for a playable game use
[`authoring-an-end-to-end-test-case`](../authoring-an-end-to-end-test-case/SKILL.md).
To add a variant to an existing mesh-animation version use
[`adding-a-mesh-animation-variant`](../adding-a-mesh-animation-variant/SKILL.md).

The worked examples: the **Aegis** colossal six-legged walking fortress, rigged and
animated once per algorithm — `test-cases/aegis-mc-anim/v1.0.0`,
`test-cases/aegis-sn-anim/v1.0.0`, and `test-cases/aegis-dc-anim/v1.0.0` (a fixed
`chassis` root; six independent three-segment legs driven by a two-tripod `march`;
main and side turrets on `caller` joints driven by a `bombardment`; a self-playing
`radar_spin`). Read the one for your algorithm alongside this skill — a new case
should look like it.

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
variant-additive brief), the `-anim` meshing binary, and a **pre-seeded `rig.json`**
containing the case's required parts, joints, and animation declarations (so the
contract exists from t=0). There is **no target model**; **no operations schema is
seeded** (the binary's `--help` is the contract).

## Creating a new case — procedure

### 1. Choose the subject, the algorithm, and design the rig

Pick a **catalog slug** (e.g. `aegis-dc-anim`) and a subject that is naturally
**articulated** — it has distinct, movable components a game would want to control.
Pick the **algorithm** for the surface character you want (bold faceted `mc-anim`,
smooth watertight `sn-anim`, crisp hard-surface `dc-anim` with `--sharp`), which
fixes the `asset_kind` and the `[tool].binary`.

Design the **required rig** exactly as for a voxel animation — the mechanics are
identical, so follow
[`authoring-a-voxel-animation-test-case`](../authoring-a-voxel-animation-test-case/SKILL.md)
(**Choose the subject and design the rig**) for the full detail. In brief:

- **Parts** — name each component, give it a `parent` (the first part is the
  **root**, no parent) and a **`pivot`** in the **shared volume's coordinates** (all
  parts share one coordinate space): the point the part's joints rotate about, **not**
  a placement offset — each part's field is composited in place where it sits on the
  assembled model. Keep the hierarchy a **tree**.
- **Joints** — for each degree of freedom a game should drive, declare a joint on a
  part: its `kind` (`rotation` in radians / `translation` in voxels), `axis`,
  `pivot`, `min`/`max`/`rest` range, and `drive`. Make the game-facing controls
  **`drive = "caller"`**; use **`drive = "auto"`** for a joint moved only by the
  model's animations (a walk cycle's hips and knees, a radar spin).
- **Animations** — declare each required animation's identity and intent (name,
  `period_ms`, `loop`, `auto_play`, and the `joints` it must drive); the model
  authors the F-curve keyframes at run time.

Keep the **required** rig to the interface a game truly needs — a stable, minimal
contract; the model may add flourish parts/joints/animations on top. Pick a
`version` (`vX.Y.Z`); a version is **immutable** once runs reference it.

### 2. Write the brief

Seed a single self-contained `specs/brief.md`. State:

- **what to sculpt** — the subject, its silhouette and orientation, and the
  `[voxel]` volume framing (which axis is up, which way is forward);
- the **exact palette** — named `#rrggbb` values, the only colors allowed (opaque;
  no alpha);
- **how meshing works** — that this is **not a cube tool**: the binary maintains a
  **continuous signed-distance field per part** and meshes each part's surface,
  shaped by **compositing** primitives (`add-*`/`subtract-*`), `--blend` for a smooth
  join (default `0` = hard), and the whole-field edits;
- **the algorithm's character** — a short paragraph telling the model to lean into
  the extractor (faceted / smooth / crisp), and, for `dc-anim` only, to hold armor
  edges crisp with hard unions and **`--sharp`**;
- **the required parts** — name each part, what it looks like, and where it attaches
  (its pivot), and that each part is sculpted **separately** with
  `<binary> --part <name>` in the **shared volume's coordinates**, positioned where
  it sits on the assembled model (a turret already up on the hull, a barrel already
  out front) — each part is its **own field**, meshed on its own;
- **the required joints** — name each caller joint, the motion it must produce, and
  its range, so the model sculpts the part to move plausibly about that pivot;
- **how the tool behaves** — the `-anim` binary is the only way to shape the field
  and edit the rig, `--part` is required on every op, `--help` lists the operations
  **and the rig subcommands**, it re-renders each part's preview **and the
  assembled-scene previews** after each call, the field starts empty, and the
  recorded operations + emitted `mesh.json` + `rig.json` are the output;
- **the required animations** — name each animation the model must author, its
  intent (a decorative idle that plays on its own, or a named playable a game
  triggers), its period and whether it loops, and the joints it must drive, so the
  model authors motion that reads (a walk cycle's leg swing, a turret's radar sweep);
- that the model **may add** its own parts/joints/animations beyond the required set,
  but must **not** drop or contradict the required interface.

The rotation-direction convention (positive pitch about `x` lifts a forward part
**up**; yaw/roll right-handed) and the minimal-stable-interface guidance are the
**same as voxel-anim** — see the voxel-animation skill's **Writing the brief**.

### 3. Write `prompt.hbs`

A short instruction pointing the model at the seeded brief, telling it to read the
`-anim` binary's `--help` (operations **and** rig subcommands) and to read both each
`parts/<part>.png` **and the assembled-scene previews** between calls — the scene is
how the model confirms its separately sculpted parts fit together. Name the field
vocabulary (`add-*`/`subtract-*`, `--blend`, and, for `dc-anim`, `--sharp`/`--smooth`)
and restate the hard requirements (shape/rig only through the tool; `--part` on every
op; produce every required part, joint, and animation; return when finished). Strict
mode — only `{{variant.*}}`, `{{#each specs}}`, and `{{workspace}}`. Model it on the
matching `aegis-*-anim` case's `prompt.hbs`. A shared **quality directive** is
prepended to every asset-generation prompt automatically at render time
(`ASSET_QUALITY_PREAMBLE` in `crates/core/src/prompt.rs`), so keep your `prompt.hbs`
factual and do not restate that framing yourself.

### 4. Write the manifest

Author `test-case.toml` per the
[manifests schema](../../../apps/docs/src/content/docs/testing/asset-generation/manifests.md)
(**Voxel cases**):

- **Metadata** — `name`, `difficulty`, `tags` (include `3d`/`voxel`/`mesh`/`rig` and
  the algorithm, e.g. `dual-contouring`/`walker`), `summary`, `description`, `prompt`,
  `max_runtime_hours`.
- **`type = "asset-generation"`** and **`asset_kind`** — one of `"mc-animation"`,
  `"sn-animation"`, `"dc-animation"` — required.
- **`[voxel]`** — the fixed `width`/`height`/`depth` and preview `background`; it
  frames each part's field, which starts empty. A meshed case must **not** declare
  `[canvas]`.
- **`[tool]`** — `binary` is the `-anim` binary for the kind (`mc-anim` / `sn-anim` /
  `dc-anim`) and `preview` **must** carry the `{part}` token (e.g. `parts/{part}.png`).
- **`[output]`** — **`actions`** with a path that **must** carry the `{part}` token
  (e.g. `parts/{part}.actions.json`), exactly as `voxel-animation`; the per-part
  extracted meshes are emitted to `meshes/{part}.json` automatically by core — it is
  **not** declared in the manifest.
- **`[model]`** — **required for this kind.** Declare the required rig **exactly as
  for `voxel-animation`** (the schema is shared): `[[model.part]]` (first is the root,
  no `parent`; each other names a declared `parent`; each a `pivot` `[x, y, z]`;
  parents form a tree), `[[model.joint]]` (`name`, `part`, `kind`, `axis`, `pivot`,
  `min`/`max`/`rest` with `min <= rest <= max`, `drive`, and the optional fixed
  compound `offset`/`orient` mount), and `[[model.animation]]` (the **required
  animations** — a unique `name`, `period_ms`, `loop`, `auto_play`, and the `joints`
  each must drive; **no keyframes** — the model authors the F-curves at run time). See
  the voxel-animation skill's **Write the manifest** for the field-by-field detail.
- A **`variants`** list (root key, before the first table) — the first entry the
  default.
- **No targets** — declare **no `[[reference]]`**; resolution rejects any.
- **`[[domain]]`** and **`[[review_item]]`** — at least one domain and a checklist
  judging the rig against the brief (the parts read as the subject; the joints pose
  correctly without detaching; the required animations play). An item may name the
  caller **joints** it is about, so the review UI surfaces that joint's viewer and
  control beside it. Each item carries only a `domain` (no `reference`). For `dc-anim`,
  include an item for the crisp hard-surface read the extractor is chosen for.

There is **no `[build]` table** and **no `[[check]]`** for this type.

### 5. Write the non-seeded docs

`description.md` and `README.md`. These never reach a run.

## Writing the brief

The brief is the test case. The rules are the same as a static meshed case plus the
rig rules from the voxel-animation skill:

- **Be self-contained.** No link outside the seeded set, and no target model; point
  at the binary's `--help` for the operations and rig subcommands.
- **Specify *what*, not *how*.** Describe the subject, palette, volume framing, the
  required parts and their pivots, and the joint motions; leave the sculpting order
  and technique to the model (except the algorithm-character nudge and any variant
  constraint).
- **Use precise, testable values.** Pin the palette to exact `#rrggbb`; state each
  part's footprint and pivot in the volume's coordinates; state each caller joint's
  axis and range. Name what must read from the rig.
- **Own the algorithm's character.** Say which extractor is in play and design to it
  — faceted `mc`, smooth `sn`, crisp/sharp `dc`.
- **Match the rotation-direction convention and design a minimal, stable joint
  interface** — these rules are identical to voxel-anim; see that skill's **Writing
  the brief**.
- **Keep the bar high.** Ask for a model that both reads as the subject and poses
  correctly — the review UI renders each caller joint as a live control and plays the
  produced animations.

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

`prompt` catches strict-mode template and manifest errors — including rig resolution
(unique parts, a single root, parent references with no cycles, joint → part
references, `kind`/`axis`/`drive` parsing, `min <= rest <= max`, and each animation's
unique name, positive `period_ms`, and declared driven `joints`). `seed` writes the
seeded repository (under `tmp/`) so you can read what the model receives — the brief,
the seeded `<binary>.config.json`, each part's blank preview, and the **pre-seeded
`rig.json`** holding the required parts, joints, and animation declarations (with
empty tracks the model fills) — and no target model.

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
