---
title: Author a Voxel Animation Test Case
---

Scaffold a new [asset-generation](/testing/asset-generation/overview/) test case
that asks a model to sculpt a **rigged** voxel model (named parts + joints it
invents) with the `voxel-anim` tool and author its **required animations**
(`asset_kind = "voxel-animation"`). This is the short version;
[Authoring a Voxel Animation Test Case](/guides/authoring/authoring-a-voxel-animation-test-case/)
covers it in full, and
[Manifests](/testing/asset-generation/manifests/#voxel-cases) is the authoritative
schema.

A **static** voxel model instead?
[Author a Voxel Model Test Case](/quickstarts/authoring/author-a-voxel-model-test-case/).
A **meshed** (SDF/CSG) animated model?
[Author a Mesh Animation Test Case](/quickstarts/authoring/author-a-mesh-animation-test-case/).

## Layout

A version lives at `test-cases/<type>/<difficulty>/<slug>/<version>/` and is **immutable** once runs
reference it — revise by adding a new version, not by editing a published one.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml    # manifest: type, asset_kind, [voxel], [tool], [output], [model]
  variants/         # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs        # rendered into the harness instruction (NOT seeded)
  description.md    # site blurb (NOT seeded); README.md — human overview (NOT seeded)
  specs/brief.md    # what to sculpt + how it moves + how the tool behaves — SEEDED
```

A run receives only the seeded brief, the `voxel-anim` binary (`--help` is the op +
rig-subcommand contract), and a **pre-seeded `rig.json`** holding just the required
animation declarations (empty tracks, `parts: []`, `joints: []`) — **no target model**.

## Steps

1. Pick a catalog **slug** (e.g. `ironward`) and an **articulated** subject — one with
   distinct movable components a game would want to see move.
2. Decide the **required animations** only: each is a `name` a game plays it by, a
   `loop` flag, and an `auto_play` flag (`true` = self-playing idle, `false` =
   game-triggered playable). Do **not** design parts, joints, pivots, ranges, or pose
   angles — the model invents the skeleton.
3. Write `specs/brief.md`: the subject and silhouette, the **exact `#rrggbb` palette**,
   the `[voxel]` volume framing (which axis is up/forward), the key features that must
   read, how the tool behaves (`--part` on every op; a sculpting op only records;
   `voxel-anim render` draws each `parts/<part>.png` **and** the assembled
   `scene/{iso,front,side,top}.png`), and the **behaviour** each required animation must
   show. Keep it
   [self-contained](/testing/end-to-end/overview/#self-contained-specifications).
4. Write `prompt.hbs` using only the documented template variables (`{{variant.*}}`,
   `{{#each specs}}`) — it renders in strict mode — pointing the model at `voxel-anim
   --help` and requiring it to `render` before finishing.
5. Write `test-case.toml`: metadata (`name`, `difficulty`, `tags` including
   `3d`/`voxel`/`rig`), `type = "asset-generation"`, `asset_kind = "voxel-animation"`,
   a `variants` list (root key before the first table; first = default), and:
   - `[voxel]` — fixed `width`/`height`/`depth` + `background`; **no `[canvas]`**. Size
     from real dimensions: **10 voxels/m** for smaller units (longest side ≤ ~8 m),
     **5 voxels/m** for larger units/structures; largest dimension ~40–150.
   - `[tool]` (`binary = "voxel-anim"`, `preview`) and `[output]` (`actions`) — each
     path **must** carry `{part}` (`parts/{part}.png`, `parts/{part}.actions.json`).
   - `[model]` — **required, carrying ONLY `[[model.animation]]` entries** (each just
     `name` + `loop` + `auto_play`). **No `[[model.part]]`/`[[model.joint]]`, no
     `period_ms`, no `joints`** — period, joints, and F-curves are the model's.
   - `[[domain]]` + `[[review_item]]` — a checklist judging the rig against the brief;
     items may name the required animations, each carrying only a `domain` (no `reference`).

   Declare **no `[[reference]]`**, **no `[build]`**, **no `[[check]]`**.

The worked example is the `ironward` siege tank (one required animation, `turret_sweep`);
for a multi-animation reference (`march`, self-playing `radar_spin`) see `aegis-mc-anim`.

## Validate

```sh
npm run lint:specs   # markdownlint-cli2 + cspell over test-cases/**
```

Then render and seed for **every** variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode + manifest errors (unique animation `name`s; no declared
parts/joints); `seed` writes the seeded set (brief, `voxel-anim.config.json`, pre-seeded
`rig.json`) to confirm it is self-contained. After editing, force a re-ingest so the
backend picks up the new tables — see
[Running the Local Service Stack](/guides/development/running-the-local-service-stack/).

## Next steps

- [Create a Voxel Animation Variant](/quickstarts/authoring/create-a-voxel-animation-variant/)
  to add a brief variation.
- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end to end.
- [Review a Run](/quickstarts/development/review-a-run/) to score the result.
