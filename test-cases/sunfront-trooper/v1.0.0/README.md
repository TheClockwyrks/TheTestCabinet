# Sunfront Trooper — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Trooper** test case: an
asset-generation case (`asset_kind = "dc-skinned"`) that asks a model to sculpt
*and rig* an armored Duneforged infantry soldier as a 24×48×20 hard-surface
character using only the `dc-skin` tool, one recorded operation at a time.

`sunfront-trooper` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged roster and shares the faction's bronze-and-canvas palette
and amber visor glow. There is no target model — the model builds toward the seeded
brief and is reviewed subjectively against it.

## Skinned, not per-part

This is a **skinned** case, the sibling of the rigid `-animation` kinds with one
decisive difference in **how the rig moves the mesh**. `dc-skin` sculpts a **single,
whole-body signed-distance field** — one continuous surface — and binds it to a
skeleton, so as a bone rotates the skin around the joint stretches and folds
**across** the seam a rigid, per-part kind cannot cross. That is why an armored
humanoid whose elbows, knees, and waist bend belongs in a skinned case rather than a
bolted-together `-animation` puppet. Because the character is one field / one mesh:

- `[tool].preview` is a **single** `model.png` and `[output].actions` a **single**
  `actions.json` — **no `{part}` token** (the one animated kind that does not
  template by part).
- The skinned `mesh.glb` (geometry plus the glTF skin — per-vertex bone weights and
  inverse-bind matrices) and `rig.json` are **emitted automatically by core**, not
  declared in the manifest.
- The per-vertex weights binding the skin are **derived automatically** at `render`
  by bone-heat diffusion (up to four bones per vertex), not painted by hand.

## The rig

The case does **not** prescribe a rig. The `[model]` table in `test-case.toml`
fixes only the **animations** the model must author, by name; the model invents
whatever bones and joints a marching, firing, bracing soldier needs and is judged on
whether its one continuous skin deforms convincingly across the joints. The three
**required animations** the model must **author** (name + intent only; the model lays
down the F-curve keyframes at run time with `define-animation`/`add-keyframe`) are:

- **`march`** (loop, not auto-play) — a game-triggered walk: a purposeful two-phase
  gait, each foot planting and holding while the body passes over it, then lifting,
  swinging, and planting, the two legs in opposite phase with the arms
  counter-swinging. Authored in place; the skin folds across the hips, knees, and
  waist.
- **`fire`** (play once, not auto-play) — a game-triggered shoulder-rifle shot: the
  rifle snaps to the shoulder, braces, and takes a single recoil kick that ripples
  through the shoulder and torso and settles, while the legs hold planted.
- **`brace`** (play once and hold, not auto-play) — a game-triggered crouch behind
  cover: the knees bend deeply, the hips and spine flex forward and the head tucks
  down, then holds; the deep bends read as the continuous skin folding across the
  joints.

The model may add its own extra bones, joints, and animations on top, but must not
drop or contradict the required animations.

## Contents

| Path             | Seeded to run? | Purpose                                                    |
| ---------------- | -------------- | ---------------------------------------------------------- |
| `specs/brief.md` | **Yes**        | The self-contained sculpting-and-rigging brief.            |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.              |
| `test-case.toml` | No             | Manifest: field volume, tool, output, the rig, and review. |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).          |
| `description.md` | No             | Site blurb.                                                |
| `README.md`      | No             | This overview.                                             |

A run receives the seeded brief, the `dc-skin` binary, a pre-seeded
`dc-skin.config.json`, and a pre-seeded `rig.json` holding the required animation
declarations (so the contract exists from the first operation); the skeleton and its
binding are the model's to invent. There is no target model and no operations schema —
the binary's `--help` is the contract.

## Variants

The Trooper ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-trooper/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
