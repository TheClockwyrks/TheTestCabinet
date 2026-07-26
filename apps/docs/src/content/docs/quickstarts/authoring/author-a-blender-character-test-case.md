---
title: Author a Blender Character Test Case
---

Scaffold a new [asset-generation](/testing/asset-generation/overview/) test case of
`asset_kind = "blender-character"` — the first Blender-authored skinned character kind: the
model builds a rigged, animated, skinned character in **headless Blender** (`bpy`) by
editing a starter `build.py` and running **`tcab-blend`**, which emits a skinned glTF
(`character.glb`) + preview `model.png`. This is the short version;
[Authoring a Blender Character Test Case](/guides/authoring/authoring-a-blender-character-test-case/)
covers it in full, and [Manifests](/testing/asset-generation/manifests/) is the
authoritative schema.

Its closest relative is the CSG
[Author a Skinned Character Test Case](/quickstarts/authoring/author-a-skinned-test-case/) —
same glTF product, from a signed-distance field rather than a real character pipeline.
Choose `blender-character` when the subject needs real topology, a hand-built armature, or
IK the CSG kinds cannot express.

## Layout

A version lives at `test-cases/<type>/<difficulty>/<slug>/<version>/` and is **immutable** once runs
reference it — revise by adding a new version, not by editing a published one.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, [voxel], [tool], [output], [model], the overall domain
  variants/              # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs             # rendered into the harness instruction (NOT seeded)
  description.md, README.md  # site blurb + human overview (NOT seeded)
  specs/brief.md         # the character + how the tool behaves — SEEDED
  specs/build.py         # the starter Blender script the model edits — SEEDED (a [[spec]])
```

A run also gets **headless Blender** + **`tcab-blend`** on `PATH` and a seeded
**`blender.config.json`** (bounds, the +Z-up/facing-`-Y` axes, output paths, animation
names). There is **no target model** — the skeleton and binding are the model's to invent;
`character.glb` and `model.png` are **core-emitted**, never in the manifest.

## Steps

1. Pick a catalog **slug** (flagship: `siege-rifleman`), the **character**, and a
   `version` (`vX.Y.Z`). Choose a body whose credibility rests on real topology and
   rigging, readable at the bounding box from silhouette and palette alone.
2. Write `specs/brief.md`: silhouette/proportions/orientation (built +Z up, facing `-Y`;
   warn against pre-rotating to +Y-up), gear **baked into the mesh**, the exact **opaque
   `#rrggbb` palette**, the **`weapon_socket`** rule (an empty hand-parented bone with no
   vertex influence — the model does **not** model the weapon), each required animation and
   how it reads as continuous-skin deformation, and that all authoring is via `build.py` +
   `tcab-blend`. Keep it
   [self-contained](/testing/end-to-end/overview/#self-contained-specifications).
3. Write `specs/build.py`: a runnable-shaped, well-commented starter that loads
   `blender.config.json`, clears the scene, and leaves `TODO`s for `build_body_mesh()`,
   `build_armature()` (incl. `weapon_socket`), `bind_skin_weights()`, and
   `author_animation(name)` — ending by calling `tcab_blend_export.export(config)`.
4. Write `prompt.hbs` using only the documented template variables (`{{variant.*}}`,
   `{{#each specs}}`; it renders in strict mode), pointing at the brief and `build.py` and
   stating the hard rules (build/rig only through Blender; bake the gear; keep
   `weapon_socket` empty; author every animation; run `tcab-blend` before returning).
5. Write `test-case.toml`: metadata, `type = "asset-generation"`,
   `asset_kind = "blender-character"`, a `variants` list, `[voxel]` (bounding box +
   `background`), `[tool]` (`binary = "tcab-blend"`, `preview = "model.png"` — a **single**
   file, no `{part}` token), `[output]` (`actions = "build.py"` — the recorded trace,
   re-run for provenance), `[model]` fixing **only** the required animations via
   `[[model.animation]]` (identity alone — no bones/joints/weights), the seeded brief
   **and** starter `build.py` as two `[[spec]]`s, and the single `overall` `[[domain]]`
   (an asset-generation case declares no `[[review_item]]` checklist).
   Declare **no `[[reference]]`, `[build]`, `[[check]]`, or per-kind
   `[canvas]`/`[sheet]`/`[ui]`/`[material]`/`[particle]`/`[audio]`**.
6. Write the non-seeded `description.md` and `README.md`.

Read the
[full guide](/guides/authoring/authoring-a-blender-character-test-case/) before you start.
The worked example is the flagship `siege-rifleman`.

## Validate

For **every** variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template and manifest errors (a stray `{part}` on
`preview`/`actions`, a missing required table); `seed` writes the seeded repository so you
can confirm the brief, `build.py`, and `blender.config.json` are self-contained.

## Next steps

- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end to end.
- [Review a Run](/quickstarts/development/review-a-run/) to assess the produced character.
