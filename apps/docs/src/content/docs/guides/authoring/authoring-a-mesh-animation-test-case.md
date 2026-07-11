---
title: Authoring a Mesh Animation Test Case
---

A **mesh animation** [asset-generation](/testing/asset-generation/overview/) test
case asks a model to **sculpt and rig a 3D model** by **compositing signed-distance
fields** — a CSG paradigm — with a **meshing binary** (`mc-anim`, `sn-anim`, or
`dc-anim`), one recorded operation at a time, toward a goal **described in a brief**;
the binary extracts a triangle mesh **per part**. As with every asset-generation case
there is **no target model**: the model is given a precise description and the freedom
to build a model that reads as it, so the case rewards a convincing, well-articulated
result rather than the faithful reproduction of a supplied mesh. Authoring one is
mostly writing a precise, **self-contained brief** that says what the subject is and
how it must move, and declaring the required animations.

It is the surface-extraction sibling of the
[voxel animation](/guides/authoring/authoring-a-voxel-animation-test-case/): instead of a single
field of opaque cubes, the model produces a **rig** — named **parts** in a
parent/child hierarchy, each an **independently-authored signed-distance field** meshed
on its own, with named **joints** (degrees of freedom) and **model-authored
animations** a consuming game poses and plays at runtime. It measures how well a model
drives the meshing tool and the rig subcommands toward the brief, not code generation,
and the result is **subjective** — reviewed against the brief.

Read the authoritative pages first, and follow them as the authority:

- [Overview](/testing/asset-generation/overview/#meshed-voxel-models) — what the type
  measures, the meshed paradigm, and **The rig: parts and joints** (the required
  animations are the contract; the parts and joints are the model's to invent);
- [Mesh binaries](/testing/asset-generation/mesh-binaries/) — the `mc-anim` / `sn-anim`
  / `dc-anim` interface: the continuous **signed-distance field**, the shared **CSG
  vocabulary** (`add-*` / `subtract-*`, `--blend`, `mirror` / `translate` / `copy` /
  `replace-color` / `clear`), the **DC-only `--sharp`** tag, the required per-op
  **`--part <name>`** (one field, log, preview, and per-part `.glb`), and **The animated
  binaries: one field per part, plus the rig** — which states the rig model is
  **identical to `voxel-anim`**;
- [Voxel binaries](/testing/asset-generation/voxel-binaries/) — the shared **rig
  subcommands** and **F-curve** interpolation the mesh docs point back to (`define-part`
  / `set-pivot` / `define-joint` / `define-animation` / `add-keyframe`; `constant` /
  `linear` / `bezier` plus the ease presets);
- [Rigging walkers](/testing/asset-generation/rigging-walkers/) — the design guidance
  for legged rigs and walk cycles (shared with voxel walkers);
- [Manifests](/testing/asset-generation/manifests/#voxel-cases) — the authoritative
  schema, whose **Voxel cases** section governs here (the meshed `[tool].binary`, the
  `[output]` op log, and the `[[model.animation]]` declarations the `[model]` table
  carries);
- [Evaluation](/testing/asset-generation/evaluation/#the-rig) — per-part review and the
  animation reconciliation (a missing required animation, or one that never actually
  animates, is a recorded, zero-scored contract gap).

This guide is self-contained and is the sole authoring reference for the animated
meshed kinds. For a **static** meshed model use
[Authoring a Mesh Model Test Case](/guides/authoring/authoring-a-mesh-model-test-case/); for a
rigged **VOXEL (cube)** model use
[Authoring a Voxel Animation Test Case](/guides/authoring/authoring-a-voxel-animation-test-case/);
for a continuous-skin **character** use
[Authoring a Skinned Test Case](/guides/authoring/authoring-a-skinned-test-case/); for a **2D**
sprite or sprite sheet use
[Authoring an Asset-Generation Test Case](/guides/authoring/authoring-an-asset-generation-test-case/);
for a playable game use
[Authoring an End-to-End Test Case](/guides/authoring/authoring-an-end-to-end-test-case/). To add
a variant to an existing mesh-animation version use
[Creating a Mesh Animation Variant](/guides/authoring/creating-a-mesh-animation-variant/).

## Mesh animation versus the skinned kinds

A mesh animation case is the rigid sibling of the **skinned** kinds — same CSG /
signed-distance-field sculpting, same F-curve rig — differing decisively in **how the
rig moves the geometry**:

- The rigid `-animation` kinds build a **separate mesh per part**, each posed rigidly
  about a pivot — wooden-puppet, mecha-style articulation. There is a **seam at every
  joint**, and there has to be, because each part is its own mesh. That is the right
  read for a tank, a turret, a mech, or a walking fortress.
- A **skinned** kind builds **one continuous mesh** bound to a skeleton and deforms it
  by per-vertex weights, so the skin stretches and folds smoothly **across** the seam a
  rigid kind cannot cross. That is what a limbed creature or a fabric-and-flesh
  character needs.

So author a mesh animation case when the subject is a **rigid machine or structure that
articulates about pivots** — its components pivot, sweep, and stride but do not deform.
If the subject is a body whose skin bends continuously across its joints, author a
skinned case instead.

## Choosing the kind

There are three animated meshed kinds, one binary each, sharing the **same authoring
workflow** (author per-part SDF/CSG fields toward a brief, plus the rig) and differing
only in **which `-anim` binary the case names** and its resulting **surface character**
— a fixed property of the binary, not a manifest knob. Pick by the surface you want:

| `asset_kind` | binary | surface character | pick for |
| --- | --- | --- | --- |
| `mc-animation` | `mc-anim` (Marching Cubes) | **bold low poly** — chunky, faceted, coarse grid | stylized, blocky machines |
| `sn-animation` | `sn-anim` (Surface Nets) | **smooth mid-fidelity** — rounded, watertight, uniform | smooth, rounded forms |
| `dc-animation` | `dc-anim` (Dual Contouring) | **crisp / sharp** — preserves sharp edges and corners | armored, hard-surface machines |

Only Dual Contouring adds a per-primitive **`--sharp` / `--smooth`** tag; `mc-anim` and
`sn-anim` do not expose it. The kind is a property of the whole version, not a variant
axis — a case is exactly one kind.

The three worked examples authored alongside this guide illustrate the split: the
**Aegis** colossal six-legged walking fortress, rigged and animated once per algorithm
— `test-cases/asset-generation/hard/aegis-mc-anim/v1.0.0`, `test-cases/asset-generation/hard/aegis-sn-anim/v1.0.0`, and
`test-cases/asset-generation/hard/aegis-dc-anim/v1.0.0`. Each `[model]` fixes only three required animations
— a `march` walk, a `bombardment` weapon showcase, and a self-playing `radar_spin` —
and the brief describes the fortress's features and how it must move; the model invents
the legs, turrets, and joints that carry it. Read the one matching your algorithm
alongside this guide; a new case should look like it.

## What a case is, and what gets seeded

A version lives under `test-cases/<type>/<difficulty>/<slug>/<version>/`. Versioning is per-case and
**immutable**: once a run references a version, that version is frozen. Revise by adding
a new version, never by editing a published one.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml          # manifest: type, asset_kind, [voxel], [tool], [output], [model] (rig), domains
  variants/               # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs              # rendered per run into the model's instruction (NOT seeded)
  description.md          # site-facing prose (NOT seeded)
  README.md               # human overview (NOT seeded)
  specs/brief.md          # the brief: what to sculpt, the parts/joints, how the tool behaves — SEEDED
```

A run receives only the seeded files: the selected variant's brief (the common brief
plus any variant-additive brief), the `-anim` meshing binary on its `PATH` (whose
`--help` is the operations **and** rig-subcommand contract), and a **pre-seeded
`rig.json`** carrying only the case's required animation declarations — empty tracks the
model fills, `parts: []`, and `joints: []` — so the animation contract exists from t=0.
There is **no target model** and **no operations schema is seeded**. Everything marked
*NOT seeded* is authoring- or site-side only.

The per-part extracted meshes (`meshes/{part}.json`) and the `rig.json` are
**core-emitted automatically** when the model runs `render` — they are **not** declared
in the manifest.

## Procedure

### 1. Choose the subject, the algorithm, and the required animations

Pick a catalog **slug** for the lineage (e.g. `aegis-dc-anim`) and a subject that is
naturally **articulated** — it has distinct, movable components a game would want to see
move. Pick the **algorithm** for the surface character you want (bold faceted `mc-anim`,
smooth watertight `sn-anim`, crisp hard-surface `dc-anim` with `--sharp`), which fixes
the `asset_kind` and the `[tool].binary`.

The only thing you fix about the rig is the set of **required animations** — exactly as
for a voxel animation, so follow
[Authoring a Voxel Animation Test Case](/guides/authoring/authoring-a-voxel-animation-test-case/)
for the full detail. In brief, for each motion the subject must perform declare a
`[[model.animation]]` with a **`name`** a game plays it by (e.g. `march`, `bombardment`,
`radar_spin`), whether it **`loop`s** (default `true`), and whether it **`auto_play`s**
(`true` = a self-playing idle, `false` = a game-triggered playable).

Do **not** design a parts list, a joint hierarchy, pivots, ranges, or pose angles — the
model **invents** the skeleton the subject needs, attaches it where it belongs, and
animates it, and working that out is the test. Keep the required animation set to the
motions a game truly needs; the model may add flourish animations on top. Pick a
`version` (`vX.Y.Z`); a version is **immutable** once runs reference it.

### 2. Write the brief

Seed a single self-contained `specs/brief.md`. State:

- **what to sculpt** — the subject, its silhouette and orientation, and the `[voxel]`
  volume framing (which axis is up, which way is forward);
- the **exact palette** — named `#rrggbb` values, the only colors allowed (opaque; no
  alpha);
- **how meshing works** — the binary maintains a continuous signed-distance field per
  part and meshes each part's surface, shaped by compositing primitives (`add-*` /
  `subtract-*`), `--blend` for a smooth join (default `0` = hard), and the whole-field
  edits;
- **which extractor meshes the fields** — name the binary (`mc-anim` / `sn-anim` /
  `dc-anim`) and state, factually, how it reconstructs the surface (a coarse faceted
  grid; a smooth watertight skin; faithful sharp edges and corners) and, for `dc-anim`,
  that a per-primitive `--sharp` / `--smooth` tag holds or rounds an edge. State the
  behaviour so the model knows the material it is working with — do **not** prescribe an
  aesthetic or tell it to "lean into" the look; how to exploit the extractor is the
  model's design choice;
- **the subject's key features** — name the components that must read (a hull, legs, a
  main turret, a side turret per flank, a radar vane) and how they relate, but **do
  not** prescribe their exact sizes, positions, pivots, or how to break them into rig
  parts — that is the model's to invent. Note that each part the model defines is
  sculpted **separately** with `<binary> --part <name>` in the **shared volume's
  coordinates**, positioned where it sits on the assembled model — each part is its
  **own field**, meshed on its own;
- **how the tool behaves** — the `-anim` binary is the only way to shape the field and
  edit the rig, `--part` is required on every op, `--help` lists the operations **and**
  the rig subcommands, and a sculpting op **only records** (it renders/meshes nothing);
  the binary's `render` on request draws each part's preview **and the assembled-scene
  previews** and emits the per-part `.glb` (`render --component <part>` for one part and
  `render --time <ms> --animation <name>` to preview a motion) — so the model must render
  before finishing; the field starts empty, and the recorded operations + emitted
  per-part `.glb` + `rig.json` are the output;
- **the required animations** — name each animation the model must author and describe
  the **behaviour** it must show in prose (a walk that plants its feet, a turret that
  sweeps its arc), whether it loops, and whether it self-plays or is game-triggered — but
  leave the joints, the period, and the pose angles to the model;
- that the model **may add** its own parts, joints, and animations beyond the required
  set, but must **not** drop or contradict the required animations.

The same self-containment and precise-values rules as an end-to-end spec apply: the
brief must stand on its own, with no link outside the seeded set and no target model, and
every visual detail written in real terms. Specify **what**, not **how** — pin only the
true requirements (the `[voxel]` volume, the exact palette, the algorithm's character,
and the required animation names); do not prescribe a parts list, a joint hierarchy,
pivots, ranges, coordinates, or pose angles, because working out the pieces a moving
subject needs *is the test*. Use emphasis sparingly — bold a genuine hard constraint (the
palette, the volume, a required animation), not half the words in a paragraph. Describing
motion in world terms and keeping the required animation set minimal are the same rules
as a voxel animation. The shared **quality directive** — the brief is the floor, not the
goal; produce the best model you can within its constraints — is prepended to every
asset-generation prompt at render time, so the brief itself stays factual and need not
restate it.

### 3. Write `prompt.hbs`

A short instruction that points the model at the seeded brief, tells it to read the
`-anim` binary's `--help` (operations **and** rig subcommands) and — because a sculpting
op **renders nothing** — to run the binary's `render` when it wants to (re)draw each
`parts/<part>.png` **and the assembled-scene previews** and read them (the scene is how
the model confirms its separately sculpted parts fit together). Name the field
vocabulary (`add-*` / `subtract-*`, `--blend`, and, for `dc-anim`, `--sharp` /
`--smooth`) and restate the hard requirements (shape and rig only through the tool;
`--part` on every op; author every required animation so it actually animates; **run
`render` before finishing** so the geometry is emitted; return when finished). The
template renders in **strict mode**, so use only the documented variables —
`{{variant.slug}}` / `{{variant.name}}` / `{{variant.description}}`, `{{#each specs}}`,
and `{{workspace}}`. Model it on the matching `aegis-*-anim` case's `prompt.hbs`.

### 4. Write the manifest

Author `test-case.toml` per the [Voxel cases](/testing/asset-generation/manifests/#voxel-cases)
schema. A mesh animation case is a meshed animated case: it declares a `[voxel]` volume
(the bounds each per-part field is framed in) and a `[model]` table of required
animations.

- **Metadata** — `slug` (the case's stable identity — the store key and what every run
  records; normally the folder name), `name`, `difficulty`, `tags` (include `3d` /
  `voxel` / `mesh` / `rig` and the algorithm, e.g. `dual-contouring` / `walker`),
  `summary`, `description`, `prompt`, `max_runtime_hours`.
- **`type = "asset-generation"`** and **`asset_kind`** — one of `"mc-animation"`,
  `"sn-animation"`, `"dc-animation"` — required (omitting `type` defaults to end-to-end,
  which then rejects these tables).
- **`[voxel]`** — the fixed `width` / `height` / `depth` and preview `background`; it
  frames each part's field, which starts empty. A meshed case must **not** declare
  `[canvas]`. **Size the volume from the subject's real dimensions at a fixed scale** so
  relative sizes are comparable across cases: pick a plausible real size in metres, then
  **10 voxels/metre for smaller units** (longest side ≤ ~8 m) or **5 voxels/metre for
  larger units and structures**, with proportions that match the subject (a walker is
  longer than it is wide). Keep the largest resulting dimension roughly in the 40–150
  band.
- **`[tool]`** — `binary` is the `-anim` binary for the kind (`mc-anim` / `sn-anim` /
  `dc-anim`) and `preview` **must** carry the `{part}` token (e.g. `parts/{part}.png`).
- **`[output]`** — **`actions`** with a path that **must** carry the `{part}` token
  (e.g. `parts/{part}.actions.json`), exactly as `voxel-animation`; the per-part
  extracted meshes are emitted to `meshes/{part}.json` automatically by core — it is
  **not** declared in the manifest.
- **`[model]`** — **required for this kind, and it carries ONLY `[[model.animation]]`
  entries**, exactly as for `voxel-animation` (the schema is shared). There are **no**
  `[[model.part]]` or `[[model.joint]]` tables; the case fixes no parts, joints, pivots,
  ranges, or pose angles. Each `[[model.animation]]` entry declares just a unique
  **`name`**, a **`loop`** flag (default `true`), and an **`auto_play`** flag (default
  `false`; `true` = a self-playing idle, `false` = a game-triggered playable) — **no
  `period_ms`, no `joints` list, and no keyframes**: the period, the joints, and the
  F-curves are the model's to invent at run time. Resolution validates only that every
  animation `name` is unique.
- A **`variants`** list (root key, before the first table) — the first entry is the
  default.
- **No `[[reference]]`, no `[build]`, no `[[check]]`.** A mesh animation case has no
  target model to score against (declaring a reference is rejected), produces emitted
  data rather than a static site, and — unlike the `draw` / `draw-sheet` sprite kinds —
  has no cheat-divergence check: its emitted geometry and rig are what is judged, however
  they were produced.
- **`[[domain]]`** and **`[[review_item]]`** — at least one domain and a checklist
  judging the produced rig against the brief (it reads as the subject from multiple
  angles; each required animation reads as its intended behaviour without parts detaching
  or clipping). An item's text can name the **required animations** it judges (e.g.
  `march`, `bombardment`), and the review UI plays the produced animations and poses the
  rig beside the checklist. Each item carries only a `domain` (no `reference`). For
  `dc-anim`, include an item for the crisp hard-surface read the extractor is chosen for.

### 5. Write the non-seeded docs

`description.md` (site blurb) and `README.md` (human overview). These never reach a run;
keep them honest about what is seeded.

## Validate your work

From the repository root, run the specs linter:

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
declares **no** parts or joints). `seed` writes the seeded repository (under `tmp/`) so
you can read exactly what the model receives — the brief, the seeded `<binary>.config.json`,
and the **pre-seeded `rig.json`** holding only the required animation declarations (empty
tracks the model fills; `parts: []`, `joints: []`) — and confirm it is self-contained,
with no target model seeded.

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
branch with a conventional-commit message scoped to the case (e.g.
`feat(<slug>): add <version> …`). Do not commit `node_modules/` or the rendered local
`tmp/` seed output.

## Next steps

- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/) — assess a run of
  your case: the reviewer scores each produced part against the brief and reconciles the
  produced animations against the required set, with the 3D viewer posing the per-part
  rig and playing the animations beside the checklist.
