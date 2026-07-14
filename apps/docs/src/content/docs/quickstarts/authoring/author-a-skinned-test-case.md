---
title: Author a Skinned Character Test Case
---

Scaffold a new [asset-generation](/testing/asset-generation/overview/) test case that
asks a model to sculpt an **organic character** — one continuous skin bound to a
model-invented skeleton, deforming smoothly across its joints — with a skinning binary
(`mc-skin`, `sn-skin`, or `dc-skin`) to match a written brief. The `asset_kind` — one of
`mc-skinned` (low-poly), `sn-skinned` (smooth mid-fidelity), or `dc-skinned` (sharp-edged,
armored) — is picked by the character's surface. This is the short version;
[Authoring a Skinned Character Test Case](/guides/authoring/authoring-a-skinned-test-case/)
covers it in full, and
[Manifests](/testing/asset-generation/manifests/#skinned-cases) is the authoritative
schema.

A **rigid** machine that articulates about pivots (a tank, a mech) is a sibling
[mesh-animation](/quickstarts/authoring/author-a-mesh-animation-test-case/) or
[voxel-animation](/quickstarts/authoring/author-a-voxel-animation-test-case/) case
instead. There is no static skinned kind — a character that never deforms is a static
[mesh-model](/quickstarts/authoring/author-a-mesh-model-test-case/) case.

## Layout

A version lives at `test-cases/<type>/<difficulty>/<slug>/<version>/` and is **immutable** once runs
reference it — revise by adding a new version, not by editing a published one.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, voxel, tool, output, model, domains
  variants/              # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs             # rendered into the harness instruction (NOT seeded)
  specs/brief.md         # the character + how the tool behaves — SEEDED
```

A run receives only the seeded brief, the binary on `PATH` (its `--help` is the ops
contract), a seeded `mc-skin.config.json`, and a `rig.json` pre-populated with the
required animations alone. There is **no target mesh** and **no operations schema**.

## Steps

1. Pick a catalog **slug** and the **character** to sculpt — a body whose motion is
   continuous skin deformation, achievable with the CSG primitives. Worked examples:
   `siege-husk` (`mc-skinned`), `caldera-slag` (`sn-skinned`), `sunfront-trooper`
   (`dc-skinned`).
2. Write `specs/brief.md`: the character, silhouette, orientation (+z forward, y up), the
   **exact opaque `#rrggbb` palette** (no alpha), the required animations and how each
   reads as continuous-skin deformation, that the **skeleton is the model's to invent**,
   and that `render` emits the geometry. Keep it
   [self-contained](/testing/end-to-end/overview/#self-contained-specifications).
3. Write `prompt.hbs` using only the documented template variables (`{{variant.*}}`,
   `{{#each specs}}`) — it renders in strict mode — pointing the model at the binary's
   `--help` and stating the hard requirements (sculpt/rig only through the tool; author
   every animation; `render` before returning).
4. Write `test-case.toml`: metadata (`name`, `difficulty`, `tags`),
   `type = "asset-generation"`, `asset_kind` (`"mc-skinned"` / `"sn-skinned"` /
   `"dc-skinned"`), a `variants` list, the `[voxel]` field bounds (`width`, `height` up,
   `depth`, `background` = the preview clear color only), and `[tool]` (`binary`,
   `preview`) + `[output]` (`actions`) — both **single files with NO `{part}` token** (the
   one animated kind that does not template by part).
5. Under `[model]`, declare **only** `[[model.animation]]` entries by **identity alone** —
   a unique `name`, a `loop` flag (default `true`), and `auto_play` (default `false`;
   `true` = a continuous breathing idle). Declare **no bones, joints, weights, period, or
   keyframes**; the model invents the skeleton and authors F-curves at run time. The
   skinned `mesh.glb` + `rig.json` are **core-emitted automatically** — never named here.
   There is **no `[[reference]]`**, **no `[build]`**, and **no `[[check]]`**.

## Validate

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

For **every** variant, render the prompt (catching strict-mode template errors, a stray
`{part}` token, or a missing required table) and inspect the seeded repository (brief +
`mc-skin.config.json` + the `rig.json`) to confirm it is self-contained.

## Next steps

- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end to end.
- [Review a Run](/quickstarts/development/review-a-run/) to score how convincingly the
  skin deforms across joints.
