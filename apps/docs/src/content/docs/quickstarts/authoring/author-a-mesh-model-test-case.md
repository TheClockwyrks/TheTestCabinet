---
title: Author a Mesh Model Test Case
---

## Scope

Scaffold an [asset-generation](/testing/asset-generation/overview/) test case for
a static meshed model: a model composites a continuous signed-distance field of
CSG primitives and meshes it with the `mc`, `sn`, or `dc` binary, one recorded
operation at a time. Read
[Authoring a Mesh Model Test Case](/guides/authoring/authoring-a-mesh-model-test-case/)
for the full procedure;
[Voxel cases](/testing/asset-generation/manifests/voxel-cases/) is the
authoritative schema.

For a rigged, animated mesh see
[Author a Mesh Animation Test Case](/quickstarts/authoring/author-a-mesh-animation-test-case/).
For discrete cube voxels see
[Author a Voxel Model Test Case](/quickstarts/authoring/author-a-voxel-model-test-case/).

## Layout

A version lives at
`test-cases/asset-generation/<difficulty>/<slug>/<version>/`. A version with runs
recorded against it is frozen; revise a case by adding a new version.

```text
test-cases/asset-generation/<difficulty>/<slug>/<version>/
  test-case.toml   # manifest: type, asset_kind, voxel, tool, output
  variants/        # one standalone TOML file per variant
  prompt.hbs       # rendered into the harness instruction; not seeded
  changelog.md     # required per-version entry; not seeded
  description.md   # site blurb; not seeded
  specs/brief.md   # what to sculpt and how the tool behaves; seeded
```

A run seeds the brief, `<binary>.config.json`, an empty action log, and a blank
preview, with the meshing binary on `PATH`. Its `--help` is the operation
contract. The case declares no `[[reference]]` and carries no target model.

## Steps

1. Pick a catalog slug and the subject to sculpt. It should read clearly at the
   volume size from silhouette and palette alone and be achievable by
   compositing CSG primitives with `add-*`, `subtract-*`, `--blend`, and
   `mirror`.
2. Pick the algorithm for the surface you want. It fixes both `asset_kind` and
   `[tool].binary`: `mc` for a low-poly faceted surface, `sn` for a smooth
   watertight one, `dc` for crisp sharp edges. Only `dc` exposes the
   per-primitive `--sharp` tag that preserves a primitive's edges and corners.
   The algorithm is a property of the whole version rather than a variant axis.
3. Write `specs/brief.md`: the subject, silhouette, orientation, the exact opaque
   `#rrggbb` palette, the volume, and which extractor meshes the field. State the
   extractor's behavior factually and leave the look to the model. Keep the
   brief self-contained.
4. Write `prompt.hbs`. It renders in strict mode against `{{variant.*}}`,
   `{{#each specs}}`, `{{workspace}}`, `{{time_limit_hours}}`, and `{{voxel.*}}`.
   Point the model at the binary's `--help` and require a `render` before
   finishing so the mesh is emitted.
5. Write `test-case.toml`: metadata (`name`, `difficulty`, `tags` including `3d`,
   `mesh`, and the algorithm), the required `changelog`,
   `type = "asset-generation"`, `asset_kind` (`"mc-model"`, `"sn-model"`, or
   `"dc-model"`), and the `variants` list. It is a root key, so it precedes the
   first table header, and the first entry is the default variant.
6. Declare `[voxel]` for the field bounds. It replaces `[canvas]`, which
   resolution rejects on a meshed case.
7. Declare `[tool]` with the meshing binary and a `preview` such as `model.png`,
   and `[output]` with an `actions` log. Both name single files; the `{part}`
   token is rejected on a static case. Core emits the extracted `mesh.glb` on
   `render`, so the manifest never names it.
8. Declare the single `overall` `[[domain]]` a human rates the model under. The
   model is judged as a whole against its brief on that one rating, so the case
   declares no `[[review_item]]` checklist, no `[model]` rig, no `[[reference]]`,
   no `[build]`, and no `[[check]]`.

The Aegis Bastion walking fortress is the worked example, authored once per
algorithm as `aegis-mc`, `aegis-sn`, and `aegis-dc`. Read the one matching your
surface.

## Validate

Run these for every variant.

```sh
npm run lint:specs
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template and manifest errors. `seed` writes the
seeded repository under `tmp/`, where you confirm the seeded set is
self-contained. After editing, force a re-ingest so a backend-driven run picks up
the change; see
[Running the Local Service Stack](/guides/development/running-the-local-service-stack/).

## Next steps

- [Create a Mesh Model Variant](/quickstarts/authoring/create-a-mesh-model-variant/)
  to add a brief variation.
- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end
  to end.
- [Review a Run](/quickstarts/development/review-a-run/) to assess the result.
