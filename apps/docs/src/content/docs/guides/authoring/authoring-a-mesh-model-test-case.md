---
title: Authoring a Mesh Model Test Case
---

A **mesh-model** [asset-generation](/testing/asset-generation/overview/) test case
asks a model to **sculpt a small 3D model** by **compositing a continuous
signed-distance field** — a CSG paradigm — with a **meshing binary** (`mc`, `sn`, or
`dc`), one recorded operation at a time, to **match a written brief**; the binary
extracts a triangle mesh from the field's zero level set. It is the
surface-extraction sibling of the [static voxel
model](/guides/authoring/authoring-a-voxel-model-test-case/): where the cube tool paints
discrete opaque cells, a meshing binary **adds material with a sphere or box and
carves it away with another** and meshes the result. As with every asset-generation
case there is **no target model**: the model is given a precise description and the
freedom to build something that reads as it, so the case rewards creativity rather
than reproducing a supplied model. Authoring one is mostly writing a precise,
**self-contained brief**.

Read the authoritative pages first: the
[Mesh binaries](/testing/asset-generation/mesh-binaries/) (the continuous
signed-distance field, the shared CSG vocabulary — `add-*`/`subtract-*`, `--blend`,
`mirror`/`translate`/`copy`/`replace-color`/`clear` — the three algorithms and their
characters, the Dual-Contouring-only `--sharp` tag, the wgpu preview, and the
per-part `.glb` output contract),
[Manifests](/testing/asset-generation/manifests/) — the authoritative schema, whose
**Voxel cases** section governs the meshed `[tool].binary` and the `[output]` op log
— the [Overview](/testing/asset-generation/overview/) (what the type measures and
why the recorded **operation log**, not the surface on disk, is the authoritative
output), and [Evaluation](/testing/asset-generation/evaluation/) (how the extracted
mesh is human-reviewed against the brief — there is no automated fidelity score).
This guide is self-contained and is the sole authoring reference for the static
meshed kinds.

This guide covers the **static** meshed kinds only. For a **rigged, animated**
meshed model (named parts + joints + F-curve animations) see
[Authoring a Mesh Animation Test Case](/guides/authoring/authoring-a-mesh-animation-test-case/).
For a **static VOXEL (cube)** model see
[Authoring a Voxel Model Test Case](/guides/authoring/authoring-a-voxel-model-test-case/); for
a 2D sprite or sprite sheet see
[Authoring an Asset-Generation Test Case](/guides/authoring/authoring-an-asset-generation-test-case/);
for a playable game see
[Authoring an End-to-End Test Case](/guides/authoring/authoring-an-end-to-end-test-case/). To
add a variant to an existing static-meshed version see
[Creating a Mesh Model Variant](/guides/authoring/creating-a-mesh-model-variant/).

## Choosing the kind

This guide covers the **three static meshed kinds** together — `mc-model`,
`sn-model`, `dc-model` — because they share the **same authoring workflow** (author
an SDF/CSG field toward a brief; the binary meshes it) and differ only in **which
binary the case names** and its resulting **surface character**. That character is a
**fixed property of the binary**, not a manifest knob: you pick the binary for the
surface you want, and the `asset_kind` names it. Pick by the subject's surface:

| `asset_kind` | binary | surface character | pick for |
| --- | --- | --- | --- |
| `mc-model` | `mc` (Marching Cubes) | **low poly** — coarse grid, chunky faceted surface | blocky, stylized reads |
| `sn-model` | `sn` (Surface Nets) | **smooth mid-fidelity** — rounded, watertight, uniform | smooth organic forms |
| `dc-model` | `dc` (Dual Contouring) | **crisp / sharp** — preserves sharp edges and corners | armored, hard-surface builds |

The character is a mechanical property of the extractor — how it reconstructs the
field's surface — not an aesthetic you dictate. Only Dual Contouring adds a
per-primitive **`--sharp` / `--smooth`** tag that holds or rounds an edge; `mc`/`sn`
do not expose it. The kind is a property of the whole version, not a variant axis — a
case is exactly one kind.

The worked examples are the **Aegis Bastion** colossal six-legged walking fortress,
authored once per algorithm — `test-cases/asset-generation/medium/aegis-mc/v1.0.0` (bold faceted low-poly),
`test-cases/asset-generation/medium/aegis-sn/v1.0.0` (smooth watertight), and `test-cases/asset-generation/medium/aegis-dc/v1.0.0`
(crisp hard-surface with `--sharp`). Read the one matching the surface you are
authoring alongside this guide; a new case should look like it.

## What a case is, and what gets seeded

A version lives under `test-cases/<type>/<difficulty>/<slug>/<version>/`. Versioning is per-case and
**immutable**: once a run references a version, that version is frozen. Revise by
adding a new version, never by editing a published one.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, [voxel], [tool], [output], the overall domain
  variants/              # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs             # rendered per run into the model's instruction (NOT seeded)
  description.md         # site-facing prose (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/brief.md         # the brief: what to sculpt + how the tool behaves — SEEDED
```

A run receives only the seeded files: the selected variant's brief (the common brief
plus any variant-additive brief). There is **no target model** — the model sculpts
toward the brief alone. It also gets the meshing binary (`mc` / `sn` / `dc`) on its
`PATH`, whose `--help` is the operations contract, and a pre-seeded
`<binary>.config.json` (volume dimensions, background, and the log / preview /
`mesh.glb` paths) plus a blank starting preview. **No operations schema is seeded** —
the binary's `--help` is the contract. Everything marked *NOT seeded* is authoring-
or site-side only; the prompt is rendered and handed to the harness as the
instruction, never written to disk.

The extracted triangle mesh (positions/normals/colors/indices in the runtime
`PartMesh` shape) that the review viewer renders is emitted as a per-part **`.glb`**
(binary glTF, `mesh.glb`) automatically by core when the model runs `render` — it is
**not** declared in the manifest.

## Procedure

### 1. Choose the subject, the algorithm, and confirm it qualifies

Pick a catalog **slug** for the lineage (e.g. `aegis-dc`) and the **subject** to
sculpt. A good subject reads clearly at the volume size from silhouette and palette
alone, needs no surrounding game context, and is achievable by **compositing CSG
primitives** (add/subtract spheres, boxes, ellipsoids, cylinders; `--blend` for soft
joins; a `mirror` plane). Subjects with a **plane of symmetry** suit `mirror` well.

Then pick the **algorithm** for the surface character you want, which fixes the
`asset_kind` and the `[tool].binary` (see [Choosing the kind](#choosing-the-kind)
above). Pick the one whose behaviour suits the subject; how to exploit it is the
model's to work out. Pick a `version` (`vX.Y.Z`).

### 2. Write the brief

Write `specs/brief.md` — a single self-contained file describing:

- **what to sculpt** — the subject, its silhouette and orientation within the volume
  (which way is forward, which axis is up), and its footprint;
- the **exact palette** — named colors with **opaque `#rrggbb`** hex values, declared
  as the only colors allowed (primitives are opaque; there is **no alpha**);
- **the volume and orientation** — the `[voxel]` bounds (`width` across, `height` up,
  `depth` in z) that frame the field, so the brief pins framing to real coordinates,
  and where the subject sits within them (primitive centers/extents are
  **real-valued**, not grid-snapped);
- **how meshing works** — the binary maintains a continuous signed-distance field and
  meshes its surface, shaped by compositing primitives (`add-*` to union material in,
  `subtract-*` to carve), `--blend` for a smooth join (default `0` = hard), and the
  whole-field edits (`mirror`/`translate`/`copy`/`replace-color`/`clear`);
- **which extractor meshes the field** — name the binary (`mc`/`sn`/`dc`) and state,
  factually, how it reconstructs the surface (a coarse faceted grid; a smooth
  watertight skin; faithful sharp edges and corners) and, for `dc`, that a
  per-primitive `--sharp` / `--smooth` tag holds or rounds an edge. State the
  behaviour so the model knows what it is working with — do **not** prescribe an
  aesthetic or tell it to "lean into" the look; how to exploit the extractor is the
  model's design choice;
- **how the tool behaves** — the binary is the only way to shape the surface, its
  `--help` lists the operations, a sculpting op **only records** (it renders/meshes
  nothing); the binary's `render` on request composites the field, extracts the
  surface, draws the preview PNG so the model can read its progress, and emits the
  mesh, so it must `render` before finishing — the field starts **empty**, and the
  recorded operations are the output (the extracted mesh is emitted as a per-part
  `.glb`; anything made another way is discarded).

The same self-containment and precise-values rules as an end-to-end spec apply: the
brief must stand on its own, with no link outside the seeded set, and every visual
detail written in real terms. The shared **quality directive** — the brief is the
floor, not the goal; produce the best-looking asset you can within its constraints —
is prepended to every asset-generation prompt at render time, so the brief itself
stays factual and need not restate it.

The rules that make a brief good:

- **Be self-contained.** A run seeds only the brief, in an isolated container with no
  access to these docs and no target model. The brief must be complete on its own and
  it points at the binary's `--help` for the operations.
- **Specify *what*, not *how* — measure creativity, not instruction-following.**
  Describe *what the subject is* (its key features, silhouette, and palette) and the
  requirements it must satisfy — not exact dimensions, coordinates, or shapes. Pin
  only what's truly required: the `[voxel]` volume, the exact palette, the
  orientation, and which extractor meshes the field. Leave the order of operations,
  the technique, and how to exploit the extractor to the model (except where a variant
  deliberately constrains technique).
- **Use precise, testable values for what you DO pin.** Pin the palette to exact
  `#rrggbb` values, frame the subject against the fixed `[voxel]` volume, name which
  axis is up and which way is forward, and name the silhouette features that must read
  — as requirements, not a primitive-by-primitive blueprint.
- **State the extractor factually; don't design for the model.** Name which extractor
  is in play and how it reconstructs the surface, then let the model decide how to
  take advantage of it. Do not prescribe the look ("crisp armor with clean planes",
  "lean into the facets"); the design is the model's.
- **Use emphasis sparingly.** Bold a genuine hard constraint (the palette, the
  volume) where it must not be missed — not half the words in a paragraph.
- **Keep the bar high.** Ask for a faithful, polished model that reads unmistakably as
  the subject from more than one angle — the frontend renders the extracted mesh
  rotating — not a rough approximation.

### 3. Write `prompt.hbs`

A short instruction that points the model at the seeded brief, tells it to read the
binary's `--help` for the operations (naming the binary — `mc`/`sn`/`dc`), and
restates the hard requirements (shape only through the tool; a sculpting op renders
nothing — run the binary's `render` to (re)draw and read the preview, and **before
finishing** so the mesh is emitted; the recorded operations are the submission;
return when finished). It renders in **strict mode**, so use only the documented
template variables (`{{variant.slug}}` / `{{variant.name}}` / `{{variant.description}}`,
`{{#each specs}}`, `{{workspace}}`) — any other reference is an error. Model it on the
matching `aegis-*` case's `prompt.hbs`.

### 4. Write the manifest

Author `test-case.toml` per the [Voxel
cases](/testing/asset-generation/manifests/#voxel-cases) schema:

- **Metadata** — `slug` (the case's stable identity — the store key and what every
  run records; normally the folder name), `name`, `difficulty`, `tags` (include
  `3d`/`voxel`/`mesh` and the algorithm, e.g. `dual-contouring`), `summary`,
  `description`, `prompt`, `max_runtime_hours`.
- **`type = "asset-generation"`** — required. Omitting it defaults to `end-to-end`,
  which then rejects the tables below.
- **`asset_kind`** — one of `"mc-model"`, `"sn-model"`, `"dc-model"`.
- **`[voxel]`** — the fixed `width`, `height` (up), `depth` and the preview
  `background` (a hex color or `transparent`). For a meshed case the volume **frames
  the signed-distance field** the surface is extracted from; it always starts
  **empty**, and `background` is only the wgpu preview PNG's clear color. A meshed case
  must **not** declare `[canvas]`. **Size the volume from the subject's real dimensions
  at a fixed scale** so relative sizes are comparable across cases: pick a plausible
  real size in metres, then **10 voxels/metre for smaller units** (longest side ≤ ~8 m)
  or **5 voxels/metre for larger units and structures**, and make the proportions match
  the subject. Keep the largest resulting dimension roughly in the 40–150 band.
- **`[tool]`** — `binary` is the meshing binary for the kind (`mc` / `sn` / `dc`), and
  `preview` is the path the binary renders the wgpu PNG to when the model runs `render`
  (a single file, e.g. `model.png` — **no** `{part}` token for a static model). **No
  operations schema** — `--help` is the contract.
- **`[output]`** — **`actions`** naming the recorded op log (a single file, e.g.
  `actions.json`, **no** `{part}` token for a static model), exactly as a cube case.
  The extracted triangle mesh is emitted as a per-part `.glb` (`mesh.glb`)
  automatically by core — it is **not** declared in the manifest.
- A **`variants`** list — an ordered array of paths to standalone variant files under
  `variants/` (the first the default — usually `base`; at least one required). It is a
  **root key**, so it must precede the first table header, and each `[[spec]]` `dest`
  defaults to its `source`.
- **No targets** — declare **no `[[reference]]`** (common *or* per-variant); resolution
  rejects any reference. The model is reviewed against its brief.
- **`[[domain]]`** — the single `overall` scoring domain, and **no `[[review_item]]`
  checklist**. How convincingly the extracted mesh realizes the brief — silhouette from
  multiple angles, palette, proportion, symmetry, and, for `dc`, the crispness of the
  sharp edges the extractor is chosen for — is judged as a whole, so the reviewer gives
  one rating and that rating is the run's (see
  [Judged on one overall rating](/testing/asset-generation/manifests/#judged-on-one-overall-rating)).
  Reporter-side; **not seeded**. Ask for each of those qualities in the brief, which is
  what the rating is given against.

There is **no `[build]` table**, **no `[[check]]`**, and **no `[model]`** table (a
static model has no rig) — resolution rejects all three for this kind.

### 5. Write the non-seeded docs

`description.md` (site blurb) and `README.md` (human overview). These never reach a
run; keep them honest about what is seeded.

## Validate your work

From the repository root:

```sh
npm run lint:specs   # markdownlint-cli2 + cspell over test-cases/**
```

If `cspell` flags a legitimate domain term, add it to `.cspell/project-words.txt` — do
not reword good prose to dodge the dictionary.

Then confirm the manifest resolves and the seeded set is self-contained by rendering
the prompt and seeding the repository for **every** variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template and manifest errors (including a stray `{part}`
token on `preview`/`actions`, or a missing required table). `seed` writes the seeded
repository (under `tmp/` by default) so you can read exactly what the model would
receive — the brief, plus the seeded `<binary>.config.json` and the blank starting
preview, and no target model.

### Re-ingest after editing

A backend-driven run (the desktop and web consoles) resolves its definition from the
backend's **immutable def store**, which skips a version it already holds — and the
asset-generation tables (`type`, `[voxel]`, `[tool]`, `[output]`) are newer fields, so
a stale def serves them empty and the run is treated as end-to-end. After editing a
case you must **force a re-ingest** for the change to reach a run:

```sh
curl -X POST http://127.0.0.1:8787/ingest \
  -H 'content-type: application/json' \
  -d '{"testCases": ["<slug>"], "force": true}'
```

Force-re-ingest overwrites the stored version in place — do this **only during
development**, while iterating on a version no run has been published against. Once a
published run references a version it is **immutable**: revise by creating a **new
version** (bump `vX.Y.Z`), never by editing and re-ingesting the published one. See
[Running the services locally](/development/running/).

Commit on the repository's default branch with a conventional-commit message scoped to
the case (e.g. `feat(<slug>): add <version> …`). Do not commit `node_modules/` or the
rendered local `tmp/` seed output. When the case is ready, exercise it end to end with
[Run a Test Case](/quickstarts/development/run-a-test-case/).

## Next steps

- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/) — assess a run of
  your case: the reviewer scores how convincingly the extracted mesh realizes the brief
  with the 3D viewer orbiting the model, reading silhouette, palette, and proportion
  from multiple angles (and, for `dc`, the crispness of the sharp edges).
