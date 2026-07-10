---
title: Author a Mesh Model Test Case
---

Scaffold a new static **mesh-model** [asset-generation](/testing/asset-generation/overview/)
test case — a 3D model the model sculpts by compositing a continuous signed-distance
field and meshing it with a binary (`mc` → `mc-model`, `sn` → `sn-model`, or `dc` →
`dc-model`), one recorded operation at a time. This is the short version;
[Authoring a Mesh Model Test Case](/guides/authoring/authoring-a-mesh-model-test-case/)
covers it in full, and
[Manifests](/testing/asset-generation/manifests/#voxel-cases) is the authoritative
schema.

A **rigged, animated** mesh instead? See
[Author a Mesh Animation Test Case](/quickstarts/authoring/author-a-mesh-animation-test-case/).
Discrete cube voxels rather than a meshed field? See
[Author a Voxel Model Test Case](/quickstarts/authoring/author-a-voxel-model-test-case/).

## Layout

A version lives at `test-cases/<slug>/<version>/` and is **immutable** once runs
reference it — revise by adding a new version.

```text
test-cases/<slug>/<version>/
  test-case.toml   # manifest: type, asset_kind, [voxel], [tool], [output], domains
  variants/        # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs       # rendered into the harness instruction (NOT seeded)
  description.md   # site blurb (NOT seeded)
  README.md        # human overview (NOT seeded)
  specs/brief.md   # what to sculpt + how the tool behaves — SEEDED
```

A run seeds only the brief, the binary on `PATH`, a pre-seeded `<binary>.config.json`,
and a blank preview. There is **no target model** and **no operations schema** — the
binary's `--help` is the contract.

## Steps

1. Pick a catalog **slug** (e.g. `aegis-dc`) and the **subject** to sculpt. It should
   read clearly at the volume size from silhouette and palette alone and be achievable
   by compositing CSG primitives (`add-*`/`subtract-*`, `--blend`, `mirror`).
2. Pick the **algorithm** for the surface you want — it fixes the `asset_kind` and
   `[tool].binary`: `mc` (low-poly faceted), `sn` (smooth watertight), `dc` (crisp sharp
   edges; only `dc` exposes a per-primitive `--sharp`/`--smooth` tag). The kind is a
   property of the whole version, not a variant axis.
3. Write `specs/brief.md`: subject, silhouette, orientation, **exact opaque `#rrggbb`
   palette**, the `[voxel]` volume, and — factually — which extractor meshes the field.
   Keep it
   [self-contained](/testing/end-to-end/overview/#self-contained-specifications); state
   the extractor's behaviour, don't prescribe the look.
4. Write `prompt.hbs` using only the documented template variables (`{{variant.*}}`,
   `{{#each specs}}`) — it renders in strict mode — pointing at the binary's `--help`
   and restating that it must `render` before finishing so the mesh is emitted.
5. Write `test-case.toml` per the
   [Voxel cases](/testing/asset-generation/manifests/#voxel-cases) schema: metadata
   (`name`, `difficulty`, `tags` — include `3d`/`mesh` and the algorithm),
   `type = "asset-generation"`, `asset_kind` (`"mc-model"`/`"sn-model"`/`"dc-model"`),
   a `variants` list (a root key, so it precedes the first table; first = default), the
   `[voxel]` volume, and the `[tool]`/`[output]` tables. `[tool].binary` is the meshing
   binary; `[tool].preview` (e.g. `model.png`) and `[output].actions` (the op log) are
   each a **single file — no `{part}` token**. Add the `[[domain]]`/`[[review_item]]`s a
   human reviews under (each carries only a `domain` — no `reference`). The extracted
   `mesh.glb` is emitted by core on `render`, **not** declared in the manifest.
6. Reject the wrong tables: a meshed case declares **no `[canvas]`**, **no `[model]`**
   (a static model has no rig), **no `[[reference]]`** (no target), **no `[build]`**,
   and **no `[[check]]`**. Write `description.md` and `README.md` (both non-seeded).

Worked examples: the **Aegis Bastion** walking fortress, authored once per algorithm
(`test-cases/aegis-mc/v1.0.0`, `aegis-sn/v1.0.0`, `aegis-dc/v1.0.0`). Read the one
matching your surface alongside the full guide before you start.

## Validate

```sh
npm run lint:specs   # markdownlint-cli2 + cspell over test-cases/**
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

Render the prompt and inspect the seeded repository for **every** variant to confirm
the manifest resolves and the seeded set is self-contained. After editing, force-re-ingest
so a backend-driven run picks up the change — see
[Running the services locally](/development/running/).

## Next steps

- [Create a Mesh Model Variant](/quickstarts/authoring/create-a-mesh-model-variant/) to
  add a brief variation.
- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end to end.
- [Review a Run](/quickstarts/development/review-a-run/) to assess the result.
