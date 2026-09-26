---
title: Author a Blender Character Test Case
---

## Scope

Scaffold an [asset-generation](/testing/asset-generation/overview/) test case of
`asset_kind = "blender-character"`: a model builds a rigged, animated, skinned
character in headless Blender by editing a starter `build.py` and running
`tcab-blend`, which exports a skinned glTF `character.glb` plus a `model.png`
preview. Read
[Authoring a Blender Character Test Case](/guides/authoring/authoring-a-blender-character-test-case/)
for the full procedure;
[Blender cases](/testing/asset-generation/manifests/blender-cases/) is the
authoritative schema.

Choose `blender-character` when the subject needs real topology, a hand-built
armature, or IK. When a signed-distance field is enough, the sibling kind is
[Author a Skinned Character Test Case](/quickstarts/authoring/author-a-skinned-test-case/).

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
  specs/build.py         # the starter Blender script the model edits; seeded
```

A run gets headless Blender and `tcab-blend` on `PATH` plus a seeded
`blender.config.json` carrying the bounding box, the authoring axes (+Z up,
facing `-Y`), the emitted glTF and preview paths, the build-script path, the
required animation names, and any required caller joints. The skeleton and
binding are the model's to invent. Core emits `character.glb` and `model.png`, so
the manifest names neither, and the case declares no `[[reference]]`.

## Steps

1. Pick a catalog slug, the character, and a `version` of the form `vX.Y.Z`.
   Choose a body whose credibility rests on real topology and rigging, readable
   at the bounding box from silhouette and palette alone.
2. Write `specs/brief.md`: silhouette, proportions, and orientation, with the
   character built +Z up and facing `-Y`; gear baked into the mesh; the exact
   opaque `#rrggbb` palette; the `weapon_socket` rule, an empty hand-parented
   bone with no vertex influence, where the weapon itself stays out of the mesh;
   each required animation and how it reads as continuous-skin deformation; and
   that all authoring runs through `build.py` and `tcab-blend`. Keep the brief
   self-contained.
3. Write `specs/build.py`: a runnable-shaped, well-commented starter that loads
   `blender.config.json`, clears the scene, and leaves `TODO`s for
   `build_body_mesh()`, `build_armature()` including `weapon_socket`,
   `bind_skin_weights()`, and `author_animation(name)`, ending by calling
   `tcab_blend_export.export(config)`.
4. Write `prompt.hbs`. It renders in strict mode against `{{variant.*}}`,
   `{{#each specs}}`, `{{workspace}}`, `{{time_limit_hours}}`, and `{{voxel.*}}`.
   Point the model at the brief and `build.py`, and state the hard rules: build
   and rig only through Blender, bake the gear, keep `weapon_socket` empty,
   author every animation, and run `tcab-blend` before returning.
5. Write `test-case.toml`: metadata, the required `changelog`,
   `type = "asset-generation"`, `asset_kind = "blender-character"`, and the
   `variants` list.
6. Declare `[voxel]` as the character's bounding box plus a `background`, and
   `[tool]` with `binary = "tcab-blend"` and `preview = "model.png"`, a single
   file with no `{part}` token. Declare `[output]` with
   `actions = "build.py"`, the recorded authoring trace that is re-run for
   provenance.
7. Declare `[model]` with one `[[model.animation]]` per required animation,
   carrying a `name`, a `loop` flag, and an `auto_play` flag. Add a
   `[[model.joint]]` for each caller DOF a game drives at runtime, such as
   `aim_pitch`, fixing its `name`, `kind`, `axis`, and `min`, `max`, and `rest`
   limits in degrees for a rotation. The bones, weights, and F-curves are the
   model's.
8. Declare both seeded files as `[[spec]]` entries. `specs/build.py` seeds to
   `build.py` with `kind = "script"`.
9. Declare the single `overall` `[[domain]]`. The character is judged as a whole
   against its brief on that one rating, so the case declares no
   `[[review_item]]` checklist, no `[build]`, no `[[check]]`, and none of the
   per-kind `[canvas]`, `[sheet]`, `[ui]`, `[material]`, `[particle]`, or
   `[audio]` tables.

`siege-rifleman` is the flagship worked example.

## Validate

Run these for every variant.

```sh
npm run lint:specs
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template and manifest errors, including a stray
`{part}` token and a missing required table. `seed` writes the seeded repository
under `tmp/`, where you confirm the brief, `build.py`, and `blender.config.json`
are self-contained.

## Next steps

- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end
  to end.
- [Review a Run](/quickstarts/development/review-a-run/) to assess the produced
  character.
