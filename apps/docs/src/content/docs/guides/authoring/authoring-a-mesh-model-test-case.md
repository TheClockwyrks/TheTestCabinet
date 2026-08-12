---
title: Authoring a Mesh Model Test Case
---

## Overview

A mesh-model [asset-generation](/testing/asset-generation/overview/) test case
asks a model to sculpt a small 3D model by compositing a continuous
signed-distance field with a meshing binary (`mc`, `sn`, or `dc`), one recorded
operation at a time, to match a written brief. The binary extracts a triangle
mesh from the field's zero level set. It is the surface-extraction sibling of the
[static voxel model](/guides/authoring/authoring-a-voxel-model-test-case/):
material is added with a sphere or box and carved away with another, and the
result is meshed. There is no target model, and the result is reviewed against
the brief.

Read the authoritative pages first:
[Mesh binaries](/testing/asset-generation/mesh-binaries/) for the field, the
shared CSG vocabulary, the three algorithms, the Dual-Contouring `--sharp` tag,
and the emitted geometry;
[Voxel cases](/testing/asset-generation/manifests/voxel-cases/) for the schema
that governs the meshed `[tool].binary` and the `[output]` log; and
[Evaluation](/testing/asset-generation/evaluation/) for how the extracted mesh is
reviewed.

This guide covers the static meshed kinds. A rigged, animated meshed model
belongs in
[a mesh-animation case](/guides/authoring/authoring-a-mesh-animation-test-case/),
and a static cube model in
[a voxel-model case](/guides/authoring/authoring-a-voxel-model-test-case/).
To add a variant to an existing version, see
[Creating a Mesh Model Variant](/guides/authoring/creating-a-mesh-model-variant/).

## Choosing the kind

The three static meshed kinds share one authoring workflow and differ in which
binary the case names and the surface character that binary produces. The
character is a property of the extractor rather than a manifest knob: pick the
binary for the surface you want, and the `asset_kind` names it.

| `asset_kind` | binary | surface character | pick for |
| --- | --- | --- | --- |
| `mc-model` | `mc` (Marching Cubes) | low poly: coarse grid, chunky faceted surface | blocky, stylized reads |
| `sn-model` | `sn` (Surface Nets) | smooth mid-fidelity: rounded, watertight, uniform | smooth organic forms |
| `dc-model` | `dc` (Dual Contouring) | crisp: preserves sharp edges and corners | armored, hard-surface builds |

Dual Contouring adds a per-primitive `--sharp` and `--smooth` tag that holds or
rounds an edge. The kind is a property of the whole version, so a case is exactly
one kind.

The worked examples are the Aegis Bastion walking fortress, authored once per
algorithm as `aegis-mc`, `aegis-sn`, and `aegis-dc` under
`test-cases/asset-generation/medium/`. Read the one matching the surface you are
authoring.

## Case layout

A version lives under `test-cases/<type>/<difficulty>/<slug>/<version>/`.
Versioning is per-case and immutable: once a run references a version, that
version is frozen. Revise by adding a new version.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, [voxel], [tool], [output]
  variants/              # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs             # rendered per run into the model's instruction (NOT seeded)
  description.md         # site-facing prose (NOT seeded)
  changelog.md           # per-version site-facing entry (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/brief.md         # the brief: what to sculpt + how the tool behaves (SEEDED)
```

A run receives the selected variant's brief, the seeded `<binary>.config.json`
(volume dimensions, background, and the log, preview, and mesh paths), an empty
action log, and a blank starting preview. The meshing binary is on its `PATH` and
its `--help` is the operations contract, so no operations schema is seeded.

The extracted triangle mesh the review viewer renders is emitted as a binary
glTF, at a path core provides rather than the manifest, when the model runs
`render`.

## Procedure

### 1. Choose the subject and the algorithm

Pick a catalog slug for the lineage and the subject to sculpt. A good subject
reads clearly at the volume size from silhouette and palette alone, needs no
surrounding game context, and is achievable by compositing CSG primitives: added
and subtracted spheres, boxes, ellipsoids, and cylinders, `--blend` for soft
joins, and a `mirror` plane. A subject with a plane of symmetry suits `mirror`
well.

Then pick the algorithm for the surface character you want, which fixes the
`asset_kind` and the `[tool].binary`. Pick a `version` (`vX.Y.Z`).

### 2. Write the brief

Write `specs/brief.md`, a single self-contained file describing:

- what to sculpt: the subject, its silhouette and orientation within the volume
  (which axis is up, which way is forward), and its footprint;
- the exact palette: named opaque `#rrggbb` values, declared as the only colors
  allowed;
- the volume and orientation, so the brief pins framing to real coordinates.
  Primitive centers and extents are real-valued rather than grid-snapped;
- how meshing works: the binary maintains a continuous signed-distance field and
  meshes its surface, shaped by compositing primitives (`add-*` to union material
  in, `subtract-*` to carve), `--blend` for a smooth join (default `0` for a hard
  union), and the whole-field edits `mirror`, `translate`, `copy`,
  `replace-color`, and `clear`;
- which extractor meshes the field: name the binary and state factually how it
  reconstructs the surface, and for `dc` that a per-primitive `--sharp` or
  `--smooth` tag holds or rounds an edge. How to exploit the extractor is the
  model's design choice;
- how the tool behaves: the binary is the only way to shape the surface, its
  `--help` lists the operations, a sculpting operation only records, and the
  binary's `render` composites the field, extracts the surface, draws the preview
  PNG, and emits the mesh, so the model must render before finishing. The field
  starts empty and the recorded operations are the output.

A brief authored as `specs/brief.md.hbs` reads its volume from `{{voxel.width}}`,
`{{voxel.height}}`, `{{voxel.depth}}`, and the inclusive maxima `{{voxel.maxX}}`,
`{{voxel.maxY}}`, and `{{voxel.maxZ}}`. The shared quality directive
(`ASSET_QUALITY_PREAMBLE` in `crates/core/src/prompt.rs`) is prepended to every
asset-generation prompt at render time, so the brief stays factual.

The rules that make a brief good:

- Be self-contained. A run seeds only the brief, in an isolated container
  with no target model. It points at the binary's `--help` for the operations.
- Specify what rather than how. Describe the subject's key features, silhouette,
  and palette, along with the requirements it must satisfy. Pin the volume, the exact
  palette, the orientation, and which extractor meshes the field, and leave the
  order of operations and the technique to the model.
- State the extractor factually. Name which extractor is in play and how it
  reconstructs the surface, then let the model decide how to take advantage of
  it.
- Use precise, testable values for what you pin. Exact `#rrggbb` colors,
  framing against the fixed volume, which axis is up and which way is forward,
  and the silhouette features that must read, as requirements rather than a
  primitive-by-primitive blueprint.
- Use emphasis sparingly. Bold a genuine hard constraint such as the palette
  or the volume.
- Keep the bar high. Ask for a polished model that reads unmistakably as the
  subject from more than one angle; the frontend renders the extracted mesh
  rotating.

### 3. Write `prompt.hbs`

A short instruction that points the model at the seeded brief, names the binary
and tells the model to read its `--help`, and restates the hard requirements:
shape only through the tool, run the binary's `render` to draw and read the
preview and again before finishing so the mesh is emitted, and return when
finished. The template renders in strict mode, and the available variables are
`{{workspace}}`, `{{variant.slug}}`, `{{variant.name}}`,
`{{variant.description}}`, `{{#each specs}}`, `{{time_limit_hours}}`, and
`{{voxel}}`.

### 4. Write the manifest

Author `test-case.toml` per the
[Voxel cases](/testing/asset-generation/manifests/voxel-cases/) schema.

- Metadata. `slug` (the stable identity every run records, normally the
  folder name), `name`, `difficulty`, `tags` (include the algorithm, such as
  `dual-contouring`), `summary`, `description`, `prompt`, and
  `max_runtime_hours`.
- `type = "asset-generation"` is required. Without it the case resolves as
  end-to-end, which rejects the tables below.
- `asset_kind` is one of `"mc-model"`, `"sn-model"`, or `"dc-model"`.
- `[voxel]` fixes `width`, `height`, `depth`, and the preview `background`.
  For a meshed case the volume frames the signed-distance field the surface is
  extracted from; it starts empty, and the case must not declare `[canvas]`. Size
  it with the
  [scale rule](/guides/authoring/authoring-a-voxel-model-test-case/#sizing-the-volume)
  the voxel-model guide states.
- `[tool]` names the meshing binary for the kind and a `preview` path the
  binary renders the PNG to. It is a single file, such as `model.png`, with no
  `{part}` token.
- `[output]` names the recorded operation log, a single file such as
  `actions.json` with no `{part}` token. The extracted mesh is emitted by core.
- `variants` is an ordered array of paths to standalone variant files, the
  first being the default (usually `base`). As a root key it precedes the first
  table header.
- No `[[reference]]`, `[build]`, `[[check]]`, or `[model]`. Resolution
  rejects all four for this kind.
- `[[domain]]` declares the single `overall` scoring domain, and the case
  declares no review checklist. Silhouette from multiple angles, palette,
  proportion, symmetry, and for `dc` the crispness of the sharp edges are judged
  together as one rating.
  Ask for each of those qualities in the brief, which is what the rating is given
  against.

### 5. Write the non-seeded docs

`description.md` (site blurb), `changelog.md`, and `README.md`. These never reach
a run.

## Validate your work

Lint the specs from the repository root:

```sh
npm run lint:specs   # markdownlint-cli2 + cspell
```

If `cspell` flags a legitimate domain term, add it to
`.cspell/project-words.txt`.

Then render the prompt and seed the repository for every variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template and manifest errors, including a stray
`{part}` token on `preview` or `actions` and a missing required table. `seed`
writes the seeded repository (under `tmp/` by default) so you can read exactly
what the model would receive: the brief, the seeded `<binary>.config.json`, and
the blank starting preview.

### Re-ingest after editing

A backend-driven run resolves its definition from the backend's immutable
definition store, which skips a version it already holds. After editing a case,
force a re-ingest:

```sh
curl -X POST http://127.0.0.1:8787/ingest \
  -H 'content-type: application/json' \
  -d '{"testCases": ["<slug>"], "force": true}'
```

Force-re-ingest overwrites the stored version in place, so use it only while
iterating on a version no run has been published against. Once a published run
references a version, revise by creating a new version. See
[Running the services locally](/development/running/).

When the case is ready, exercise it with
[Run a Test Case](/quickstarts/development/run-a-test-case/). Commit with a
conventional-commit message scoped to the case, such as
`feat(<slug>): add <version>`.

## Next steps

- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/)
  assesses a run of your case. The reviewer scores how convincingly the extracted
  mesh realizes the brief, with the 3D viewer orbiting the model.
