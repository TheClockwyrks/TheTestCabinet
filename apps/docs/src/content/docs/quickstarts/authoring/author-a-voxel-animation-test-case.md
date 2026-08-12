---
title: Author a Voxel Animation Test Case
---

## Scope

Scaffold an [asset-generation](/testing/asset-generation/overview/) test case of
`asset_kind = "voxel-animation"`: a rigged cube model a model sculpts with the
`voxel-anim` binary and animates. The case fixes the required animations; the
parts and joints that realize them are the model's to invent. Read
[Authoring a Voxel Animation Test Case](/guides/authoring/authoring-a-voxel-animation-test-case/)
for the full procedure;
[Voxel cases](/testing/asset-generation/manifests/voxel-cases/) is the
authoritative schema.

For a static cube model see
[Author a Voxel Model Test Case](/quickstarts/authoring/author-a-voxel-model-test-case/).
For a rigged meshed model see
[Author a Mesh Animation Test Case](/quickstarts/authoring/author-a-mesh-animation-test-case/).

## Layout

A version lives at
`test-cases/asset-generation/<difficulty>/<slug>/<version>/`. A version with runs
recorded against it is frozen; revise a case by adding a new version.

```text
test-cases/asset-generation/<difficulty>/<slug>/<version>/
  test-case.toml    # manifest: type, asset_kind, voxel, tool, output, model
  variants/         # one standalone TOML file per variant
  prompt.hbs        # rendered into the harness instruction; not seeded
  changelog.md      # required per-version entry; not seeded
  description.md    # site blurb; not seeded
  specs/brief.md    # subject, motion, and tool behavior; seeded
```

A run seeds the brief, `voxel-anim.config.json`, and a `rig.json` pre-populated
with the required animation declarations alone, with empty tracks, `parts: []`,
and `joints: []`. The binary's `--help` is the operation and rig-subcommand
contract. The case declares no `[[reference]]` and carries no target model.

## Steps

1. Pick a catalog slug and an articulated subject, one with distinct movable
   components a game would want to see move.
2. Decide the required animations. Each is a `name` a game plays it by, a `loop`
   flag, and an `auto_play` flag, where `true` means a self-playing idle and
   `false` means a game-triggered playable. Leave parts, joints, pivots, ranges,
   and pose angles to the model.
3. Size the volume from real dimensions: 10 voxels per metre for smaller units
   whose longest side is about 8 m or less, and 5 voxels per metre for larger
   units and structures. Keep the largest dimension roughly in the 40 to 150
   band.
4. Write `specs/brief.md`: the subject and silhouette, the exact opaque
   `#rrggbb` palette, the volume framing (which axis is up, which way is
   forward), the key features that must read, and the behavior each required
   animation must show. Cover how the tool behaves: every operation takes
   `--part`, a sculpting operation records without rendering, and a bare
   `voxel-anim render` re-emits every part's geometry and preview and composes
   the assembled scene views. Keep the brief self-contained.
5. Write `prompt.hbs`. It renders in strict mode against `{{variant.*}}`,
   `{{#each specs}}`, `{{workspace}}`, `{{time_limit_hours}}`, and `{{voxel.*}}`.
   Point the model at `voxel-anim --help` and require a `render` before
   finishing.
6. Write `test-case.toml`: metadata (`name`, `difficulty`, `tags` including `3d`,
   `voxel`, and `rig`), the required `changelog`, `type = "asset-generation"`,
   `asset_kind = "voxel-animation"`, and the `variants` list. It is a root key,
   so it precedes the first table header, and the first entry is the default
   variant.
7. Declare `[voxel]` with fixed `width`, `height`, `depth`, and `background`. It
   replaces `[canvas]`, which resolution rejects on a voxel case.
8. Declare `[tool]` with `binary = "voxel-anim"` and `[output]`. Both paths carry
   the `{part}` token, as in `parts/{part}.png` and `parts/{part}.actions.json`,
   because an animated model writes one file per part.
9. Declare `[model]`, which is required, carrying `[[model.animation]]` entries
   with a unique `name`, a `loop` flag, and an `auto_play` flag. The period,
   joints, and F-curves are the model's.
10. Declare the single `overall` `[[domain]]`. The rig and its animations are
    judged as a whole against the brief on that one rating, so the case declares
    no `[[review_item]]` checklist, no `[[reference]]`, no `[build]`, and no
    `[[check]]`.

`ironward`, a siege tank with one required `turret_sweep`, is the worked example.
`sunfront-aegis` and `caldera-colossus` are multi-animation references.

## Validate

Run these for every variant.

```sh
npm run lint:specs
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template and manifest errors, including duplicate
animation names and a missing `{part}` token. `seed` writes the seeded repository
under `tmp/`, where you confirm the brief, `voxel-anim.config.json`, and the
pre-seeded `rig.json` are self-contained. After editing, force a re-ingest so the
backend picks up the new tables; see
[Running the Local Service Stack](/guides/development/running-the-local-service-stack/).

## Next steps

- [Create a Voxel Animation Variant](/quickstarts/authoring/create-a-voxel-animation-variant/)
  to add a brief variation.
- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end
  to end.
- [Review a Run](/quickstarts/development/review-a-run/) to score the result.
