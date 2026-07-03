# Sunfront Lancer — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Lancer** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a tall bipedal Duneforged marksman-mech as a 44×64×64
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time.

`sunfront-lancer` is the catalog slug for this case. It is one of the `sunfront-*`
Duneforged voxel roster and shares the faction's brass-and-sandstone palette and
solar-amber team accent. There is no target model — the model builds toward the
seeded brief and is reviewed subjectively against it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]` table:

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `torso` | *(root)* | `[0, 0, 0]` | The upper body and head |
| `thigh_l` | `torso` | `[14, 26, 24]` | The left upper leg |
| `shin_l` | `thigh_l` | `[14, 14, 24]` | The left lower leg |
| `foot_l` | `shin_l` | `[14, 3, 24]` | The left foot (short, flat) |
| `thigh_r` | `torso` | `[30, 26, 24]` | The right upper leg |
| `shin_r` | `thigh_r` | `[30, 14, 24]` | The right lower leg |
| `foot_r` | `shin_r` | `[30, 3, 24]` | The right foot |
| `weapon` | `torso` | `[22, 44, 30]` | The long center rail-lance |

Each leg is its **own** independent three-segment / two-joint chain (thigh +
shin +
short flat foot), on its own hip directly above its own foot, with a bent-knee rest
pose so the foot can stay planted as the body passes over it.

- **`weapon_pitch`** (caller, rotation about `x`, `-0.6..0.6`) — the game-facing
  control: aims the rail-lance up and down about its chest mount.
- **`hip_l` / `knee_l` / `foot_l`** and **`hip_r` / `knee_r` / `foot_r`** (auto,
  rotation about `x`) — the six leg joints the required `walk` animation drives:
  a
  big hip sweep (`-0.5..0.5`), a reverse/digitigrade knee fold (`-1.4..0.2`, rest
  `-0.7`), and a small flat-foot ankle tilt (`-0.3..0.3`).

The case requires two model-authored animations (declarations only — the model
authors the F-curves): a playable **`walk`** (period 800 ms, the two legs in
opposite phase with a planted stance phase and an eased foot-plant) and a
weapon-only **`fire`** (period 500 ms, the lance recoil) the reviewer can play
back. The model may add its own extra parts, joints, and animations on top, but
must not drop or contradict the required interface.

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
`rig.json` holding the required parts and joints (so the contract exists from the
first operation). There is no target model and no operations schema — the binary's
`--help` is the contract.

## Variants

The Lancer ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-lancer/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
