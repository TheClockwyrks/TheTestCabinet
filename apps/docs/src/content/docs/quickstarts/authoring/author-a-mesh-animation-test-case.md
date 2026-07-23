---
title: Author a Mesh Animation Test Case
---

Scaffold a new [asset-generation](/testing/asset-generation/overview/) test case for a
**rigged, animated meshed model** — the model sculpts per-part signed-distance fields with a
meshing binary (`mc-anim`, `sn-anim`, or `dc-anim`; `asset_kind` `"mc-animation"` /
`"sn-animation"` / `"dc-animation"`) and rigs them, declaring only the **required animations**
while the **parts and joints are the model's to invent**. This is the short version;
[Authoring a Mesh Animation Test Case](/guides/authoring/authoring-a-mesh-animation-test-case/)
covers it in full, and [Manifests](/testing/asset-generation/manifests/#voxel-cases) is the
authoritative schema.

Authoring a **static** meshed model instead? See
[Author a Mesh Model Test Case](/quickstarts/authoring/author-a-mesh-model-test-case/). For a
rigged **VOXEL (cube)** model see
[Author a Voxel Animation Test Case](/quickstarts/authoring/author-a-voxel-animation-test-case/).

## Layout

A version at `test-cases/<type>/<difficulty>/<slug>/<version>/` is **immutable** once runs reference it — revise
by adding a new version, not editing a published one.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml         # type, asset_kind, [voxel], [tool], [output], [model], the overall domain
  variants/              # one standalone TOML per variant (listed in `variants`)
  prompt.hbs             # rendered into the harness instruction — NOT seeded
  specs/brief.md         # what to sculpt + how the tool behaves — SEEDED
```

Non-seeded: `description.md`, `README.md`. A run gets only the brief, the `-anim` binary on
`PATH` (`--help` = the operations **and** rig-subcommand contract), and a **pre-seeded
`rig.json`** with just the required animation declarations (empty tracks, `parts: []`,
`joints: []`). There is **no target model**; per-part meshes and the filled `rig.json` are
core-emitted on `render`.

## Steps

1. Pick a catalog **slug** and an **articulated** subject, then the **algorithm** — faceted
   `mc-anim`, smooth `sn-anim`, crisp `dc-anim` (only `dc-anim` exposes `--sharp`/`--smooth`).
   That fixes the `asset_kind` and `[tool].binary`.
2. Fix the **required animations**: one `[[model.animation]]` per motion, with a unique
   `name` (e.g. `march`, `bombardment`, `radar_spin`), a `loop` flag (default `true`), and an
   `auto_play` flag (default `false`; `true` = self-playing idle). Do **not** design parts,
   joints, pivots, ranges, or pose angles.
3. Write `specs/brief.md`: subject, orientation, the `[voxel]` framing, the **exact `#rrggbb`
   palette**, how the binary meshes each part's field (`add-*`/`subtract-*`, `--blend`), the
   features that must read, and each animation's **behaviour** in prose. Keep it
   [self-contained](/testing/end-to-end/overview/#self-contained-specifications); *what*, not
   *how*.
4. Write `prompt.hbs` (strict mode — only `{{variant.*}}`, `{{#each specs}}`, `{{workspace}}`):
   point at the brief and the binary's `--help`, require `render` before finishing.
5. Write `test-case.toml` per the tables below; `[tool].preview` and `[output].actions` **must**
   carry the `{part}` token (`parts/{part}.png`, `parts/{part}.actions.json`).

| Required | Rejected |
| --- | --- |
| `type = "asset-generation"` + `asset_kind` (`mc`/`sn`/`dc`-`animation`) | `[canvas]` — meshed cases use `[voxel]` |
| `[voxel]`; `[tool].binary` + `{part}` `preview`; `[output].actions` with `{part}` | `[[reference]]` — no target model |
| `[model]` with **only** `[[model.animation]]` (`name`, `loop`, `auto_play`) | `[build]`, `[[check]]` — no site, no cheat check |
| `variants` (root key, first = default); the single `overall` `[[domain]]` | `[[review_item]]`s — judged as a whole, on one rating; `[[model.part]]` / `[[model.joint]]` — model-invented |

Worked example: **Aegis**, a six-legged walking fortress rigged once per algorithm —
`aegis-mc-anim` / `aegis-sn-anim` / `aegis-dc-anim` (`v1.0.0`). Read the one matching yours.

## Validate

```sh
npm run lint:specs   # markdownlint-cli2 + cspell over test-cases/**
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode and manifest errors (unique animation `name`s; no parts/joints
in `[model]`; `{part}` on `preview`/`actions`). `seed` writes the seeded repo under `tmp/` to
verify self-containment (brief + pre-seeded `rig.json`). After editing,
**force a re-ingest** so a backend-driven run picks it up — see
[Running the services locally](/development/running/).

## Next steps

- [Create a Mesh Animation Variant](/quickstarts/authoring/create-a-mesh-animation-variant/) — add a brief variation.
- [Run a Test Case](/quickstarts/development/run-a-test-case/) — exercise it end to end.
- [Review a Run](/quickstarts/development/review-a-run/) — score the produced rig against the brief.
