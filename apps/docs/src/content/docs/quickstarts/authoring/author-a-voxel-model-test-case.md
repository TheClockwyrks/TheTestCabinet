---
title: Author a Voxel Model Test Case
---

Scaffold a new static [voxel-model](/testing/asset-generation/overview/) test case —
one where a model sculpts a small 3D model out of **opaque `#rrggbb` voxels** with the
`voxel` binary, one recorded operation at a time, to match a written brief
(`asset_kind = "voxel-model"`). This is the short version;
[Authoring a Voxel Model Test Case](/guides/authoring/authoring-a-voxel-model-test-case/)
covers it in full, and [Manifests](/testing/asset-generation/manifests/#voxel-cases)
is the authoritative schema.

Building a different kind? A **rigged, animated** model (named parts + joints) is
[Author a Voxel Animation Test Case](/quickstarts/authoring/author-a-voxel-animation-test-case/);
a **smooth, meshed** model (a signed-distance field) is
[Author a Mesh Model Test Case](/quickstarts/authoring/author-a-mesh-model-test-case/);
a **2D sprite** is
[Author an Asset-Generation Test Case](/quickstarts/authoring/author-an-asset-generation-test-case/).

## Layout

A version lives at `test-cases/<type>/<difficulty>/<slug>/<version>/` and is **immutable** once runs
reference it — revise by adding a new version, not by editing a published one.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, [voxel], [tool], [output], domains
  variants/              # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs             # rendered into the harness instruction (NOT seeded)
  description.md         # site blurb (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/brief.md         # what to sculpt + how the tool behaves — SEEDED
```

A run seeds only the brief plus the pre-seeded `voxel.config.json` (volume dims,
background, log/preview/geometry paths). There is **no target model** — the model
sculpts toward the brief alone.

## Steps

1. Pick a catalog **slug** (e.g. `skyshard`) and the **subject** to sculpt. It should
   read clearly at the volume size from silhouette and palette alone, need no game
   context, and be achievable in the `voxel` op set (boxes, lines, spheres,
   ellipsoids, cylinders, a `mirror` plane — subjects with a plane of symmetry suit
   `mirror`).
2. Write `specs/brief.md`: the subject and its silhouette, the `[voxel]` volume and
   orientation (which axis is up, which way is forward), the **exact `#rrggbb`
   palette** (opaque, no alpha), and how the tool behaves — a sculpting op only
   records and renders nothing, so `voxel render` must run **before finishing** to
   emit the geometry. Point the model at the binary's `--help`; there is **no
   operations schema**. Keep it self-contained and specify *what*, not *how*.
3. Write `prompt.hbs` using only the documented template variables (`{{variant.*}}`,
   `{{#each specs}}`) — it renders in strict mode — pointing the model at the brief
   and the binary's `--help`.
4. Write `test-case.toml`: metadata (`name`, `difficulty`, `tags` including
   `3d`/`voxel`), `type = "asset-generation"`, `asset_kind = "voxel-model"`, a
   `variants` list (a root key, so before the first table; first = default), and:
   - **`[voxel]`** — `width`, `height` (up), `depth` (in voxels) plus a `background`
     used only as the preview clear color. It **replaces `[canvas]`**; a voxel case
     declaring `[canvas]` is rejected.
   - **`[tool]`** (`binary = "voxel"`, `preview`) and **`[output]`** (`actions`) —
     both name **single files** (`"model.png"`, `"actions.json"`); a static model has
     no `{part}` token.
   - at least one scoring **`[[domain]]`** (e.g. `fidelity`) and the `[[review_item]]`
     checklist (each carries only a `domain`, no `reference`).
   - **No `[model]`, no `[canvas]`, no `[[reference]]`, no `[build]`/`[[check]]`.** A
     voxel case has no rig, no target model, and — unlike the sprite kinds — **no
     cheat-divergence check**: the emitted geometry is judged however it was produced.
5. **Size the volume from real dimensions at a fixed scale** so cases stay comparable:
   pick a plausible real size in metres, then **10 voxels/metre for smaller units**
   (longest side ≤ ~8 m) or **5 voxels/metre for larger units**, keeping the largest
   dimension roughly in the **40–150** band.
6. Write the non-seeded `description.md` and `README.md`.

The `skyshard` interceptor (a symmetric, forward-swept fighter jet) is the worked
example; read it alongside
[Authoring a Voxel Model Test Case](/guides/authoring/authoring-a-voxel-model-test-case/)
before you start.

## Validate

```sh
npm run lint:specs   # markdownlint-cli2 + cspell over test-cases/**
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

Render and seed **every** variant. `prompt` catches strict-mode template and manifest
errors (a stray `{part}` on `preview`/`actions`, or a stray
`[model]`/`[canvas]`/`[[reference]]`); `seed` writes the seeded repository so you can
confirm the brief plus `voxel.config.json` is self-contained, with no target model. To
push edits into a backend-driven run, force a re-ingest — see
[Running the Local Service Stack](/guides/development/running-the-local-service-stack/).

## Next steps

- [Create a Voxel Model Variant](/quickstarts/authoring/create-a-voxel-model-variant/)
  to add a brief variation.
- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end to end.
- [Review a Run](/quickstarts/development/review-a-run/) to assess the result.
