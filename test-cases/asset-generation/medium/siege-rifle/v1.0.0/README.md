# Siege Warden Rifle — `v1.0.0`

This is version `v1.0.0` of the **Siege Warden Rifle** test case: an
asset-generation case (`asset_kind = "blender-prop"`) that asks a model to build the
Warden squad's standard-issue service rifle as a **static hard-surface prop** in
**Blender**, by authoring a single Blender Python script and running it headless. It
is the first **`blender-prop`** (static Blender) case in the repo.

`siege-rifle` is the catalog slug for this case. The rifle is the weapon a
[Warden Rifleman](../../../hard/siege-rifleman/) carries — the model that a game
hangs on that character's empty `weapon_socket`. There is no target model — the
model builds toward the seeded brief and is reviewed subjectively against it.

## A static prop, not a rigged character

This is the **static** member of the Blender family. Where the
[`blender-character`](../../../hard/siege-rifleman/) kind builds a skinned, animated
character and the `blender-mechanism` kind builds a rigidly-articulated one, a
**`blender-prop`** is just **geometry** — no armature, no skin, no animations. It is
authored through the same channel: the run container ships **headless Blender** plus
the **`tcab-blend`** runner and a bundled glTF export helper. The model:

- Writes **`build.py`**, a Blender (`bpy`) script that builds the whole rifle as
  clean hard-surface geometry, colored from the palette with vertex colors or
  materials.
- Runs **`tcab-blend`**, which execs `blender --background --python build.py --
  <config.json>`. This is the **only** sanctioned build path. There is no operation
  log — **`build.py` is the recorded authoring trace**.
- The export helper emits **`model.glb`** (a native, **unrigged** **glTF 2.0**) and
  renders the preview **`model.png`**. Both are the emitted output; they are not
  declared in the manifest. The output is a **native game format**, not a
  Test-Cabinet-specific one.

Because the prop is one asset, `[tool].preview` (`model.png`) and `[output].actions`
(`build.py`) are **single files** — no `{part}` token.

## No `[model]` table

A `blender-prop` case declares **no `[model]` table**: the prop is static, so there
is no rig and no animation to require. The whole contract is the `[voxel]` bounding
box, the `[tool]`, the `[output]`, the brief, and the review. This is what
distinguishes it in the manifest from the animated Blender kinds
(`blender-character` / `blender-mechanism`), which require `[model]`.

## What it is

A believable modern **service rifle** — receiver, barrel to a clear muzzle,
handguard / foregrip, shoulder stock, magazine, sight, pistol grip, and trigger
guard — assembled into one coherent weapon, built in a held orientation (barrel
front-to-back, muzzle toward -Y, sight on top, magazine below, stock at the back).

## Palette

The Warden palette (from Siege's `specs/overview.md`): a **gunmetal `#565c64`** /
**dark-iron `#2b2f36`** body with **charcoal-slate `#3a4048`** furniture and small
**Warden Cobalt `#3d7bd6`** unit accents (and a sparing **pale-cobalt `#bfe0ff`**
optic glint). These are the only colors allowed.

## Contents

| Path             | Seeded to run? | Purpose                                                        |
| ---------------- | -------------- | -------------------------------------------------------------- |
| `specs/brief.md` | **Yes**        | The self-contained modeling brief.                             |
| `specs/build.py` | **Yes**        | The starter Blender script the model edits (seeded as a spec). |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.                  |
| `test-case.toml` | No             | Manifest: bounds, tool, output, and review.                    |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).              |
| `description.md` | No             | Site blurb.                                                    |
| `README.md`      | No             | This overview.                                                 |

A run receives the seeded brief and the seeded starter `build.py`, plus headless
Blender and `tcab-blend` on its `PATH` and a pre-seeded `blender.config.json`
(the bounding box, the Blender-native authoring axes — +Z up, muzzle facing -Y,
which the export converts to the family's +Y-up/+Z-forward glTF — the output paths,
and an **empty** `animations` list). Every shape is the model's to invent; there is
no target model.

## How it's validated

The `model.glb` the run emits is the authoritative output. Validation is
**emitted-file authoritative** — there is no op-replay:

1. `model.glb` exists and is a well-formed GLB.
2. It carries at least one **mesh** (a model is present). A prop is **not** required
   to carry a skin (it is unrigged) and declares no animations to reconcile.
3. **Provenance re-run**: `tcab-blend` is re-run on the seeded `build.py` in a clean
   environment and the re-exported glb's summary (mesh count) is compared to the
   run's `model.glb`; divergence is a recorded note (the Blender analogue of the
   sprite kinds' cheat-divergence), and it degrades gracefully if the runner or
   Blender is absent.

The emitted glTF is rendered in the browser as an auto-rotating turntable, and a
reviewer judges it against the brief.

## Variants

The rifle ships a single default variant — `base`, declared in `variants/base.toml`.
It seeds the common brief and starter script and is rated on the case's single
`overall` scoring domain; it adds no specs or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/.../siege-rifle/v1.0.0/`). Each version is self-contained and immutable
once a run references it; design revisions land as new version folders.
