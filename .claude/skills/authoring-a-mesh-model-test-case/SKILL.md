---
description: Read this skill before creating a new STATIC meshed asset-generation test case or version (asset_kind = "mc-model", "sn-model", or "dc-model" — a 3D model the model sculpts as a signed-distance field composited from CSG primitives with the `mc`/`sn`/`dc` meshing binary, one recorded operation at a time, then extracted as a triangle mesh), or when authoring or revising such a case's brief, prompt, or manifest under test-cases/. For a rigged, ANIMATED meshed model use authoring-a-mesh-animation-test-case; for a static VOXEL (cube) model use authoring-a-voxel-model-test-case; for a 2D sprite/sprite-sheet use authoring-an-asset-generation-test-case; for a playable game use authoring-an-end-to-end-test-case.
name: authoring-a-mesh-model-test-case
---

# Authoring a Static Meshed-Model Test Case

## What a mesh-model test case is

A mesh-model test case asks a model to **sculpt a small 3D model** by
**compositing a continuous signed-distance field** — a CSG paradigm — with a
**meshing binary**, one recorded operation at a time, toward a goal **described in
a brief**; the binary extracts a triangle mesh from the field's zero level set. It
is the surface-extraction sibling of the [static voxel
model](../authoring-a-voxel-model-test-case/SKILL.md): where the cube tool paints
discrete opaque cells, a meshing binary **adds material with a sphere or box and
carves it away with another** and meshes the result. There is **no target model**;
the result is **subjective** — the model is given a precise written brief and the
freedom to build something that matches it, so the case rewards creativity rather
than reproducing a supplied model. Authoring one is mostly writing a precise,
self-contained **brief**.

This skill covers the **three static meshed kinds** together — `mc-model`,
`sn-model`, `dc-model` — because they share the **same authoring workflow** (author
an SDF/CSG field toward a brief; the binary meshes it) and differ only in **which
binary the case names** and its resulting **surface character**:

| `asset_kind` | binary | character |
| --- | --- | --- |
| `mc-model` | `mc` (Marching Cubes) | **bold low poly** — chunky, faceted, coarse grid |
| `sn-model` | `sn` (Surface Nets) | **smooth mid-fidelity** — rounded, watertight, uniform |
| `dc-model` | `dc` (Dual Contouring) | **crisp / sharp** — preserves sharp edges and corners |

The character is a **fixed property of the binary**, not a manifest knob: you pick
the binary for the surface you want, and the `asset_kind` names it. Only Dual
Contouring adds a per-primitive **`--sharp` / `--smooth`** tag (see below); `mc`/`sn`
do not expose it.

The authoritative docs are the source of truth — **read them first** and follow
them as the authority:

- [`testing/asset-generation/overview.md`](../../../apps/docs/src/content/docs/testing/asset-generation/overview.md)
  — what the type measures, why the recorded **operation log** (not the surface on
  disk) is the authoritative output, and the meshed-voxel-model paradigm;
- [`testing/asset-generation/mesh-binaries.md`](../../../apps/docs/src/content/docs/testing/asset-generation/mesh-binaries.md)
  — the `mc`/`sn`/`dc` interface: the continuous **signed-distance field**, the
  shared **CSG vocabulary** (`add-*`/`subtract-*`, `--blend`, `mirror`/`translate`/
  `copy`/`replace-color`/`clear`), the three algorithms and their characters, the
  **Dual-Contouring-only `--sharp`** tag, the wgpu preview, and the **`mesh.json`**
  output contract;
- [`testing/asset-generation/manifests.md`](../../../apps/docs/src/content/docs/testing/asset-generation/manifests.md)
  — every manifest field and the rules enforced at resolution (see **Voxel cases**,
  including the meshed `[tool].binary` and the `[output]` op log);
- [`testing/asset-generation/evaluation.md`](../../../apps/docs/src/content/docs/testing/asset-generation/evaluation.md)
  — how the extracted mesh is human-reviewed against the brief (there is no
  automated fidelity score).

This skill covers the **static** meshed kinds only. For a **rigged, animated**
meshed model (named parts + joints + F-curve animations) use
[`authoring-a-mesh-animation-test-case`](../authoring-a-mesh-animation-test-case/SKILL.md).
For a **static VOXEL (cube)** model use
[`authoring-a-voxel-model-test-case`](../authoring-a-voxel-model-test-case/SKILL.md);
for a **2D** sprite or sprite sheet use
[`authoring-an-asset-generation-test-case`](../authoring-an-asset-generation-test-case/SKILL.md);
for a playable game use
[`authoring-an-end-to-end-test-case`](../authoring-an-end-to-end-test-case/SKILL.md).
To add a variant to an existing static-meshed version use
[`adding-a-mesh-model-variant`](../adding-a-mesh-model-variant/SKILL.md).

The worked examples: the **Aegis Bastion** colossal six-legged walking fortress,
authored once per algorithm — `test-cases/aegis-mc/v1.0.0` (bold faceted low-poly),
`test-cases/aegis-sn/v1.0.0` (smooth watertight), and `test-cases/aegis-dc/v1.0.0`
(crisp hard-surface with `--sharp`). Read the one for your algorithm alongside this
skill — a new case should look like it.

## Anatomy of a test case version

```text
test-cases/<slug>/<version>/
  test-case.toml          # manifest: type, asset_kind, voxel, tool, output, domains, review items
  variants/               # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs              # rendered per run into the model's instruction (NOT seeded)
  description.md          # site-facing prose (NOT seeded)
  README.md               # human overview (NOT seeded)
  specs/
    brief.md              # the brief: what to sculpt + how the tool behaves — SEEDED
```

What a run receives: the selected variant's seeded specs (the common brief + any
variant-additive brief). There is **no target model** — the model sculpts toward
the brief alone. It also gets the meshing binary (`mc`, `sn`, or `dc`) in its
environment, whose `--help` is the operations contract; **no operations schema is
seeded**. Everything marked *NOT seeded* is site-side only; the prompt is rendered
and handed to the harness as the instruction, never written to disk.

## Creating a new case — procedure

### 1. Choose the subject, the algorithm, and confirm it qualifies

Pick a **catalog slug** for the lineage (e.g. `aegis-dc`) and the **subject** to
sculpt. A good subject reads clearly at the volume size from silhouette and palette
alone, needs no surrounding game context, and is achievable by **compositing CSG
primitives** (add/subtract spheres, boxes, ellipsoids, cylinders; `--blend` for
soft joins; a `mirror` plane). Subjects with a **plane of symmetry** suit `mirror`
well.

Then pick the **algorithm** for the surface character you want, which fixes the
`asset_kind` and the `[tool].binary`:

- **`mc-model` / `mc`** — bold, chunky, **low-poly**: design confident readable
  masses whose blocky facets *are* the aesthetic; mostly hard unions, `--blend`
  reserved for a few deliberate soft joins. Don't chase fine detail the coarse grid
  cannot hold.
- **`sn-model` / `sn`** — **smooth, rounded, watertight**: cast/molded armor,
  domed turrets, cylindrical barrels, all flowed into one skin with `--blend`.
  Corners round by construction — don't fight it for knife-edges.
- **`dc-model` / `dc`** — **crisp, hard-surface, sharp**: flat planes, clean panel
  seams, sharp facets. A hard union (`--blend 0`) makes a sharp crease for free, and
  `dc` alone exposes a **`--sharp`** flag (vs `--smooth`) to hold armor edges
  knife-clean. This crispness is the whole point of choosing `dc`.

Pick a `version` (`vX.Y.Z`); a version is **immutable** once runs reference it —
revise by adding a new version, not by editing a published one.

### 2. Write the brief

Seed a single self-contained `specs/brief.md`. State:

- **what to sculpt** — the subject, its silhouette and orientation within the
  volume (which way is forward, which axis is up), and its footprint;
- the **exact palette** — named colors with `#rrggbb` values, declared as the only
  colors allowed (primitives are opaque; there is **no alpha**);
- **the volume and orientation** — the `[voxel]` bounds (`width` across, `height`
  up, `depth` in z) that frame the field, so the brief pins framing to real
  coordinates, and where the subject sits within them (primitive centers/extents
  are **real-valued**, not grid-snapped);
- **how meshing works** — that this is **not a cube tool**: the binary maintains a
  **continuous signed-distance field** and meshes its surface, shaped by
  **compositing** primitives (`add-*` to union material in, `subtract-*` to carve),
  `--blend` for a smooth join (default `0` = hard), and the whole-field edits
  (`mirror`/`translate`/`copy`/`replace-color`/`clear`);
- **the algorithm's character** — one short paragraph telling the model to *lean
  into* the extractor's look (faceted low-poly / smooth watertight / crisp sharp),
  and, for `dc` only, that it should use hard unions and the **`--sharp`** tag to
  hold edges crisp;
- **how the tool behaves** — the binary is the only way to shape the surface, its
  `--help` lists the operations, it re-composites the field and re-renders the
  preview PNG after each call so the model can read its progress, the field starts
  **empty**, and the recorded operations (and the emitted `mesh.json`) are the
  output (anything made another way is discarded).

The self-containment, *what-not-how*, and precise-values rules from **Writing the
brief** below apply.

### 3. Write `prompt.hbs`

A short instruction that points the model at the seeded brief, tells it to read the
binary's `--help` for the operations (naming the binary — `mc`/`sn`/`dc`), and
restates the hard requirements (shape only through the tool; read the preview
between calls; the emitted `mesh.json` is the submission; return when finished). It
renders in **strict mode**, so use only the documented template variables
(`{{variant.*}}`, `{{#each specs}}`, `{{workspace}}`) — any other reference is an
error. Model it on the matching `aegis-*` case's `prompt.hbs`. A shared **quality
directive** (the brief is the floor, not the goal; produce the best-looking asset
you can within its constraints) is prepended to *every* asset-generation prompt
automatically at render time (`ASSET_QUALITY_PREAMBLE` in `crates/core/src/prompt.rs`),
so keep your `prompt.hbs` factual and do not restate that "aim high" framing
yourself.

### 4. Write the manifest

Author `test-case.toml` per the
[manifests schema](../../../apps/docs/src/content/docs/testing/asset-generation/manifests.md)
(the **Voxel cases** section):

- **Metadata** — `slug` (the case's stable identity — the store key and what every run records; normally the folder name), `name`, `difficulty`, `tags` (include `3d`/`voxel`/`mesh` and the
  algorithm, e.g. `dual-contouring`), `summary`, `description`, `prompt`,
  `max_runtime_hours`.
- **`type = "asset-generation"`** — required. Omitting it defaults to `end-to-end`,
  which then rejects the tables below.
- **`asset_kind`** — one of `"mc-model"`, `"sn-model"`, `"dc-model"`.
- **`[voxel]`** — the fixed `width`, `height` (up), `depth` and the preview
  `background` (a hex color or `transparent`). For a meshed case the volume **frames
  the signed-distance field** the surface is extracted from; it always starts
  **empty**, and `background` is only the wgpu preview PNG's clear color. A meshed
  case must **not** declare `[canvas]`.
- **`[tool]`** — `binary` is the meshing binary for the kind (`mc` / `sn` / `dc`),
  and `preview` is the path the binary renders the wgpu PNG to after each call (a
  single file, e.g. `model.png` — **no** `{part}` token for a static model). **No
  operations schema** — `--help` is the contract.
- **`[output]`** — **`actions`** naming the recorded op log (a single file, e.g.
  `actions.json`, **no** `{part}` token for a static model), exactly as a cube case.
  The extracted triangle mesh (positions/normals/colors/indices in the runtime
  `PartMesh` shape) that the review viewer renders is emitted to `mesh.json`
  automatically by core — it is **not** declared in the manifest.
- A **`variants`** list — an ordered array of paths to standalone variant files
  under `variants/` (the first the default — usually `base`; at least one
  required). It is a **root key**, so it must precede the first table header, and
  each `[[spec]]` `dest` defaults to its `source`.
- **No targets** — declare **no `[[reference]]`** (common *or* per-variant);
  resolution rejects any reference. The model is reviewed against its brief.
- **`[[domain]]`** and **`[[review_item]]`** — at least one scoring domain (e.g.
  `fidelity`) and the reviewer checklist judging how convincingly the extracted mesh
  realizes the brief (silhouette from multiple angles, palette, proportion,
  symmetry, and — for `dc` — the crispness of the sharp edges the extractor is
  chosen for). Each item carries only a `domain` (plus `id`/`title`/`text`/optional
  `weight`) — no `reference` (there is no target to pair with). Reporter-side; **not
  seeded**.

There is **no `[build]` table**, **no `[[check]]`**, and **no `[model]`** table (a
static model has no rig) — resolution rejects all three for this kind.

### 5. Write the non-seeded docs

`description.md` (site blurb) and `README.md` (human overview). These never reach a
run; keep them honest about what is seeded.

## Writing the brief

The brief is the test case. The rules that make one good:

- **Be self-contained.** A run seeds only the brief, in an isolated container with
  no access to these docs and no target model. The brief must be complete on its
  own — no link outside the seeded set — and it points at the binary's `--help` for
  the operations.
- **Specify *what*, not *how*.** Describe the subject, palette, volume framing, and
  orientation the model must achieve; leave the order of operations and technique to
  the model (except where a variant deliberately constrains technique, or where the
  algorithm's character warrants a nudge — "lean into the facets", "hold the edges
  crisp with `--sharp`").
- **Use precise, testable values.** Pin the palette to exact `#rrggbb` values,
  state the footprint and framing in the fixed `[voxel]` volume's coordinates, name
  which axis is up and which way is forward, and name the silhouette features that
  must read. Vague prose is the most common failure.
- **Own the algorithm's character.** Say plainly which extractor is in play and
  what it is *for*, so the model designs to its strength — a chunky faceted read for
  `mc`, a smooth watertight skin for `sn`, crisp hard-surface armor for `dc` — rather
  than fighting the grid.
- **Keep the bar high.** Ask for a faithful, polished model that reads unmistakably
  as the subject from more than one angle — the frontend renders the extracted mesh
  rotating — not a rough approximation.

## Validating

From the repository root:

```sh
npm run lint:specs   # markdownlint-cli2 + cspell over test-cases/**
```

- If `cspell` flags a legitimate domain term, add it to
  [`.cspell/project-words.txt`](../../../.cspell/project-words.txt) — do not reword
  good prose to dodge the dictionary.
- Confirm the manifest resolves and the seeded set is self-contained by rendering
  the prompt and seeding the repository for **every** variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template and manifest errors; `seed` writes the seeded
repository (under `tmp/` by default) so you can read exactly what the model would
receive — the brief, plus the seeded `<binary>.config.json` and the blank starting
preview, and no target model.

### Re-ingest after editing

A backend-driven run (the desktop and web consoles) resolves its definition from
the backend's **immutable def store**, which skips a version it already holds — and
the asset-generation tables (`type`, `[voxel]`, `[tool]`, `[output]`) are newer
fields, so a stale def serves them empty and the run is treated as end-to-end.
After editing a case you must **force a re-ingest** for the change to reach a run:

```sh
curl -X POST http://127.0.0.1:8787/ingest \
  -H 'content-type: application/json' \
  -d '{"testCases": ["<slug>"], "force": true}'
```

Force-re-ingest overwrites the stored version in place — do this **only during
development**, while iterating on a version no run has been published against. Once
a published run references a version it is **immutable**: revise by creating a
**new version** (bump `vX.Y.Z`), never by editing and re-ingesting the published
one. See
[`development/running.md`](../../../apps/docs/src/content/docs/development/running.md).

Commit on the repository's default branch with a conventional-commit message scoped
to the case (e.g. `feat(<slug>): add <version> …`). Do not commit `node_modules/`
or the rendered local `tmp/` seed output.
