# Sunfront Sentinel — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Sentinel** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* an upright bipedal Duneforged war-mech as a 44×64×40 opaque-voxel
model using only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-sentinel` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model — the model builds
toward the seeded brief and is reviewed subjectively against it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]` table.
Each leg is its own **three-segment** chain (thigh → shin → flat foot) on its own
hip directly above its own foot:

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `torso` | *(root)* | `[0, 0, 0]` | The upper body and head |
| `thigh_l` | `torso` | `[14, 26, 20]` | Left thigh |
| `shin_l` | `thigh_l` | `[14, 14, 20]` | Left shin |
| `foot_l` | `shin_l` | `[14, 3, 20]` | Left flat foot |
| `thigh_r` | `torso` | `[30, 26, 20]` | Right thigh |
| `shin_r` | `thigh_r` | `[30, 14, 20]` | Right shin |
| `foot_r` | `shin_r` | `[30, 3, 20]` | Right flat foot |
| `weapon` | `torso` | `[30, 40, 24]` | The right-arm rifle |

- **`weapon_pitch`** (caller, rotation about `x`, `-0.7..0.7`) — the game-facing
  control: aims the right-arm rifle up and down about its shoulder mount.
- **`hip_<id>`** / **`knee_<id>`** / **`foot_<id>`** for `<id>` in `{l, r}` (auto,
  rotation about `x`) — the three joints of each leg: the hip sweep
  (`-0.5..0.5`), a reverse/digitigrade knee resting clearly bent (`-1.4..0.2`,
  rest `-0.7`), and a small flat-foot ankle tilt (`-0.3..0.3`). Driven by the
  model-authored `walk` animation, not by the caller.

The `[model]` table also declares two **required animations** the model must
**author** (name + intent only; the model lays down the F-curve keyframes at run
time with `define-animation`/`add-keyframe`):

- **`walk`** (period 800 ms, loop, not auto-play) — drives all six leg joints in
  a
  two-phase gait: a planted-flat stance where the foot sits still on the ground
  while the mech passes over it, then a swing that lifts, carries forward, and
  plants (an `ease-in` into the foot-plant), the two legs in opposite phase.
- **`fire`** (period 500 ms, loop, not auto-play) — drives only `weapon_pitch` in
  a quick recoil nod so a reviewer can watch the rifle recoil without dragging the
  slider.

The model may add its own extra parts, joints, and animations on top, but must not
drop or contradict the required interface.

## Contents

| Path             | Seeded to run? | Purpose                                                    |
| ---------------- | -------------- | ---------------------------------------------------------- |
| `specs/brief.md` | **Yes**        | The self-contained sculpting-and-rigging brief.            |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.              |
| `test-case.toml` | No             | Manifest: voxel volume, tool, output, the rig, and review. |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).          |
| `description.md` | No             | Site blurb.                                                |
| `README.md`      | No             | This overview.                                             |

A run receives the seeded brief, the `voxel-anim` binary, and a pre-seeded
`rig.json` holding the required parts, joints, and animation declarations (so the
contract exists from the first operation). There is no target model and no
operations schema — the binary's `--help` is the contract.

## Variants

The Sentinel ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-sentinel/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
