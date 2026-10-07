---
title: Author a Mesh Animation Test Case
---

## Scope

Scaffold an [asset-generation](/testing/asset-generation/overview/) test case for
a rigged, animated meshed model: a model sculpts per-part signed-distance fields
with the `mc-anim`, `sn-anim`, or `dc-anim` binary and rigs them. The case fixes
the required animations; the parts and joints that realize them are the model's
to invent. Read
[Authoring a Mesh Animation Test Case](/guides/authoring/authoring-a-mesh-animation-test-case/)
for the full procedure;
[Voxel cases](/testing/asset-generation/manifests/voxel-cases/) is the
authoritative schema.

For a static meshed model see
[Author a Mesh Model Test Case](/quickstarts/authoring/author-a-mesh-model-test-case/).
For a rigged cube model see
[Author a Voxel Animation Test Case](/quickstarts/authoring/author-a-voxel-animation-test-case/).

## Layout

A version lives at
`test-cases/asset-generation/<difficulty>/<slug>/<version>/`. A version with runs
recorded against it is frozen; revise a case by adding a new version.

```text
test-cases/asset-generation/<difficulty>/<slug>/<version>/
  test-case.toml   # manifest: type, asset_kind, voxel, tool, output, model
  variants/        # one standalone TOML file per variant
  prompt.hbs       # rendered into the harness instruction; not seeded
  changelog.md     # required per-version entry; not seeded
  description.md   # site blurb; not seeded
  specs/brief.md   # what to sculpt and how the tool behaves; seeded
```

A run seeds the brief, `<binary>.config.json`, and a `rig.json` pre-populated
with the required animation declarations alone, with empty tracks, `parts: []`,
and `joints: []`. The `-anim` binary's `--help` is the operation and
rig-subcommand contract. Core emits the per-part meshes and the filled `rig.json`
on `render`. The case declares no `[[reference]]` and carries no target model.

## Steps

1. Pick a catalog slug and an articulated subject, then the algorithm: faceted
   `mc-anim`, smooth `sn-anim`, or crisp `dc-anim`. Only `dc-anim` exposes the
   per-primitive `--sharp` tag. The algorithm fixes both `asset_kind` and
   `[tool].binary`.
2. Fix the required animations: one `[[model.animation]]` per motion, each with a
   unique `name` such as `march` or `radar_spin`, a `loop` flag, and an
   `auto_play` flag, where `true` means a self-playing idle. Leave parts, joints,
   pivots, ranges, and pose angles to the model.
3. Write `specs/brief.md`: the subject, orientation, the volume framing, the
   exact opaque `#rrggbb` palette, how the binary meshes each part's field with
   `add-*`, `subtract-*`, and `--blend`, the features that must read, and each
   animation's behavior in prose. Keep the brief self-contained, and specify
   what to build rather than how.
4. Write `prompt.hbs`. It renders in strict mode against `{{variant.*}}`,
   `{{#each specs}}`, `{{workspace}}`, `{{time_limit_hours}}`, and `{{voxel.*}}`.
   Point the model at the brief and the binary's `--help`, and require a `render`
   before finishing.
5. Write `test-case.toml` per the table below. `[tool].preview` and
   `[output].actions` each carry the `{part}` token, as in `parts/{part}.png` and
   `parts/{part}.actions.json`.

| Declared                                                                                            | Rejected                                                            |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `type = "asset-generation"` and `asset_kind` (`mc-animation` / `sn-animation` / `dc-animation`)     | `[canvas]`, replaced by `[voxel]`                                   |
| `changelog`; `[voxel]`; `[tool].binary` with a `{part}` `preview`; `[output].actions` with `{part}` | `[[reference]]`, since there is no target model                     |
| `[model]` carrying `[[model.animation]]` entries (`name`, `loop`, `auto_play`)                      | `[build]` and `[[check]]`, since there is no served build           |
| `variants` as a root key, first entry the default; the single `overall` `[[domain]]`                | `[[review_item]]`, since the rig is judged as a whole on one rating |

The Aegis six-legged walking fortress is the worked example, rigged once per
algorithm as `aegis-mc-anim`, `aegis-sn-anim`, and `aegis-dc-anim`. Read the one
matching your surface.

## Validate

Run these for every variant.

```sh
npm run lint:specs
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template and manifest errors, including duplicate
animation names and a missing `{part}` token. `seed` writes the seeded repository
under `tmp/`, where you confirm the brief and the pre-seeded `rig.json` are
self-contained. After editing, force a re-ingest so a backend-driven run picks up
the change; see
[Running the Local Service Stack](/guides/development/running-the-local-service-stack/).

## Next steps

- [Create a Mesh Animation Variant](/quickstarts/authoring/create-a-mesh-animation-variant/)
  to add a brief variation.
- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end
  to end.
- [Review a Run](/quickstarts/development/review-a-run/) to score the produced rig
  against the brief.
