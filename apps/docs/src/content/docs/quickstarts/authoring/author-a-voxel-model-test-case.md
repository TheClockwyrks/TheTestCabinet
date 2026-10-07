---
title: Author a Voxel Model Test Case
---

## Scope

Scaffold an [asset-generation](/testing/asset-generation/overview/) test case of
`asset_kind = "voxel-model"`: a static 3D model a model sculpts out of opaque
`#rrggbb` voxels with the `voxel` binary, one recorded operation at a time, to
match a written brief. Read
[Authoring a Voxel Model Test Case](/guides/authoring/authoring-a-voxel-model-test-case/)
for the full procedure;
[Voxel cases](/testing/asset-generation/manifests/voxel-cases/) is the
authoritative schema.

For a rigged, animated cube model see
[Author a Voxel Animation Test Case](/quickstarts/authoring/author-a-voxel-animation-test-case/).
For a smooth, meshed model built from a signed-distance field see
[Author a Mesh Model Test Case](/quickstarts/authoring/author-a-mesh-model-test-case/).

## Layout

A version lives at
`test-cases/asset-generation/<difficulty>/<slug>/<version>/`. A version with runs
recorded against it is frozen; revise a case by adding a new version.

```text
test-cases/asset-generation/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, voxel, tool, output
  variants/              # one standalone TOML file per variant
  prompt.hbs             # rendered into the harness instruction; not seeded
  changelog.md           # required per-version entry; not seeded
  description.md         # site blurb; not seeded
  specs/brief.md         # what to sculpt and how the tool behaves; seeded
```

A run seeds the brief plus `voxel.config.json`, an empty action log, and a blank
preview. The model sculpts toward the brief alone; the case declares no
`[[reference]]` and carries no target model.

## Steps

1. Pick a catalog slug and the subject to sculpt. It should read clearly at the
   volume size from silhouette and palette alone, need no game context, and be
   achievable in the `voxel` operation set: boxes, lines, spheres, ellipsoids,
   cylinders, and a `mirror` plane. A subject with a plane of symmetry suits
   `mirror`.
2. Size the volume from real dimensions at a fixed scale so cases stay
   comparable. Pick a plausible real size in metres, then use 10 voxels per metre
   for smaller units whose longest side is about 8 m or less, and 5 voxels per
   metre for larger units. Keep the largest dimension roughly in the 40 to 150
   band.
3. Write `specs/brief.md`: the subject and its silhouette, the volume and its
   orientation (which axis is up, which way is forward), the exact opaque
   `#rrggbb` palette, and how the tool behaves. A sculpting operation records
   without rendering, so state that `voxel render` runs before finishing to emit
   the geometry. Point the model at the binary's `--help`, which is the operation
   contract. Keep the brief self-contained, and specify what to build rather than
   how.
4. Write `prompt.hbs`. It renders in strict mode against `{{variant.*}}`,
   `{{#each specs}}`, `{{workspace}}`, `{{time_limit_hours}}`, and `{{voxel.*}}`.
   A spec template sees `{{version}}`, `{{variant.*}}`, and `{{voxel.*}}`, so a
   brief reads its volume from one source of truth and serves every size variant.
5. Write `test-case.toml`: metadata (`name`, `difficulty`, `tags` including `3d`
   and `voxel`), the required `changelog`, `type = "asset-generation"`,
   `asset_kind = "voxel-model"`, and the `variants` list. It is a root key, so it
   precedes the first table header, and the first entry is the default variant.
6. Declare `[voxel]`: `width`, `height` (up), and `depth` in voxels, plus a
   `background` used as the preview clear color. It replaces `[canvas]`, which
   resolution rejects on a voxel case.
7. Declare `[tool]` with `binary = "voxel"` and a `preview` path, and `[output]`
   with an `actions` path. Both name single files such as `model.png` and
   `actions.json`; the `{part}` token belongs to the per-part animated kinds and
   is rejected here.
8. Declare the single `overall` `[[domain]]` a human rates the model under. The
   model is judged as a whole against its brief on that one rating, so the case
   declares no `[[review_item]]` checklist, no `[model]` rig, no `[[reference]]`,
   no `[build]`, and no `[[check]]`.

`skyshard`, a symmetric forward-swept interceptor, is the worked example.

## Validate

Run these for every variant.

```sh
npm run lint:specs
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template and manifest errors, including a stray
`{part}` token on `preview` or `actions` and a stray `[model]`, `[canvas]`, or
`[[reference]]`. `seed` writes the seeded repository under `tmp/`, where you
confirm the brief and `voxel.config.json` are self-contained. To push edits into
a backend-driven run, force a re-ingest; see
[Running the Local Service Stack](/guides/development/running-the-local-service-stack/).

## Next steps

- [Create a Voxel Model Variant](/quickstarts/authoring/create-a-voxel-model-variant/)
  to add a brief variation.
- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end
  to end.
- [Review a Run](/quickstarts/development/review-a-run/) to assess the result.
