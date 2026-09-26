---
title: Author a Skinned Character Test Case
---

## Scope

Scaffold an [asset-generation](/testing/asset-generation/overview/) test case for
an organic character: one continuous skin bound to a model-invented skeleton,
deforming smoothly across its joints, sculpted with the `mc-skin`, `sn-skin`, or
`dc-skin` binary. Read
[Authoring a Skinned Character Test Case](/guides/authoring/authoring-a-skinned-test-case/)
for the full procedure;
[Skinned cases](/testing/asset-generation/manifests/skinned-cases/) is the
authoritative schema.

A rigid machine that articulates about pivots, such as a tank or a mech, belongs
in a
[mesh-animation](/quickstarts/authoring/author-a-mesh-animation-test-case/) or
[voxel-animation](/quickstarts/authoring/author-a-voxel-animation-test-case/)
case. A character that never deforms belongs in a static
[mesh-model](/quickstarts/authoring/author-a-mesh-model-test-case/) case.

## Layout

A version lives at
`test-cases/asset-generation/<difficulty>/<slug>/<version>/`. A version with runs
recorded against it is frozen; revise a case by adding a new version.

```text
test-cases/asset-generation/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, voxel, tool, output, model
  variants/              # one standalone TOML file per variant
  prompt.hbs             # rendered into the harness instruction; not seeded
  changelog.md           # required per-version entry; not seeded
  description.md         # site blurb; not seeded
  specs/brief.md         # the character and tool behavior; seeded
```

A run seeds the brief, `<binary>.config.json`, and a `rig.json` pre-populated
with the required animations alone, with the skinning binary on `PATH`. Its
`--help` is the operation contract. Core emits the single `mesh.glb` and the
filled `rig.json` on `render`. The case declares no `[[reference]]` and carries
no target mesh.

## Steps

1. Pick a catalog slug and the character to sculpt: a body whose motion is
   continuous skin deformation, achievable with the CSG primitives.
2. Pick the `asset_kind` from the character's surface: `mc-skinned` for low-poly,
   `sn-skinned` for smooth mid-fidelity, `dc-skinned` for sharp-edged and
   armored. It fixes `[tool].binary` to the matching `-skin` binary.
3. Write `specs/brief.md`: the character, silhouette, orientation (+z forward, y
   up), the exact opaque `#rrggbb` palette, the required animations and how each
   reads as continuous-skin deformation, that the skeleton is the model's to
   invent, and that `render` emits the geometry. Keep the brief self-contained.
4. Write `prompt.hbs`. It renders in strict mode against `{{variant.*}}`,
   `{{#each specs}}`, `{{workspace}}`, `{{time_limit_hours}}`, and `{{voxel.*}}`.
   Point the model at the binary's `--help` and state the hard requirements:
   sculpt and rig only through the tool, author every animation, and `render`
   before returning.
5. Write `test-case.toml`: metadata (`name`, `difficulty`, `tags`), the required
   `changelog`, `type = "asset-generation"`, `asset_kind` (`"mc-skinned"`,
   `"sn-skinned"`, or `"dc-skinned"`), and the `variants` list.
6. Declare `[voxel]` for the field bounds: `width`, `height` (up), `depth`, and a
   `background` used as the preview clear color.
7. Declare `[tool]` with the skinning binary and a `preview`, and `[output]` with
   an `actions` log. Both name single files. A skinned case is the animated kind
   that emits one whole-body mesh, so the `{part}` token is rejected.
8. Declare `[model]` carrying `[[model.animation]]` entries by identity alone: a
   unique `name`, a `loop` flag, and an `auto_play` flag, where `true` means a
   continuous breathing idle. The skeleton, weights, period, and F-curves are the
   model's.
9. Declare the single `overall` `[[domain]]`. The character is judged as a whole
   against its brief on that one rating, so the case declares no
   `[[review_item]]` checklist, no `[[reference]]`, no `[build]`, and no
   `[[check]]`.

Worked examples: `siege-husk` for `mc-skinned`, `caldera-slag` for `sn-skinned`,
and `sunfront-trooper` for `dc-skinned`.

## Validate

Run these for every variant.

```sh
npm run lint:specs
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template and manifest errors, including a stray
`{part}` token and a missing required table. `seed` writes the seeded repository
under `tmp/`, where you confirm the brief, the tool config, and the pre-seeded
`rig.json` are self-contained.

## Next steps

- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end
  to end.
- [Review a Run](/quickstarts/development/review-a-run/) to score how convincingly
  the skin deforms across joints.
