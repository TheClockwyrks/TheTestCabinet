# Sunfront Aegis — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Aegis** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a colossal Duneforged **six-legged walking fortress** — a
tiered, prowed multi-gun war-fortress that dwarfs every buildable unit and
strides on six **independent, two-jointed legs** — as an 88×80×104 opaque-voxel
model using only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-aegis` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-bronze
palette and solar-amber team accent. There is no target model — the model builds
toward the seeded brief and is reviewed subjectively against it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]`
table — **nineteen parts** (the hull, six two-segment legs, the main turret +
cannon, two side turrets, and the radar):

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `chassis` | *(root)* | `[0, 0, 0]` | The armored fortress hull, raised on legs |
| `leg_lf` / `shin_lf` | `chassis` / `leg_lf` | `[14, 30, 78]` / `[10, 14, 78]` | Left-front thigh + shin |
| `leg_lm` / `shin_lm` | `chassis` / `leg_lm` | `[14, 30, 52]` / `[10, 14, 52]` | Left-middle thigh + shin |
| `leg_lr` / `shin_lr` | `chassis` / `leg_lr` | `[14, 30, 26]` / `[10, 14, 26]` | Left-rear thigh + shin |
| `leg_rf` / `shin_rf` | `chassis` / `leg_rf` | `[73, 30, 78]` / `[77, 14, 78]` | Right-front thigh + shin |
| `leg_rm` / `shin_rm` | `chassis` / `leg_rm` | `[73, 30, 52]` / `[77, 14, 52]` | Right-middle thigh + shin |
| `leg_rr` / `shin_rr` | `chassis` / `leg_rr` | `[73, 30, 26]` / `[77, 14, 26]` | Right-rear thigh + shin |
| `main_turret` | `chassis` | `[44, 60, 56]` | The big central turret |
| `main_gun` | `main_turret` | `[44, 66, 74]` | The main cannon on the turret front |
| `left_turret` | `chassis` | `[12, 44, 52]` | The rotating left-side turret, on its sponson |
| `right_turret` | `chassis` | `[75, 44, 52]` | The rotating right-side turret, on its sponson |
| `radar` | `chassis` | `[44, 72, 40]` | The decorative sweeping radar vane |

The joints — **sixteen caller** and **one auto** — and the deliberate drive of
each:

- **`hip_*`** / **`knee_*`** (caller, rotation about `x`) — twelve leg joints,
  a hip and a knee for each of the six legs (`lf, lm, lr, rf, rm, rr`). The hip
  swings the leg fore-and-aft (`-0.4..0.4`); the knee bends the shin
  (`-0.2..1.0`) to **lift the foot clear of the ground**. Each leg is
  independent, on its own hip above its own foot — so no single pivot drags a
  bank of feet below ground. Caller-driven, so the legs hold planted at rest and
  stride only under the `march` animation.
- **`main_turret_yaw`** (caller, rotation about `y`, `-0.35..0.35`) — a narrow
  forward cone that keeps the main cannon pointed forward; the fortress turns
  its hull to aim.
- **`main_gun_pitch`** (caller, rotation about `x`, `-0.2..0.8`) — elevates the
  main cannon about its mount.
- **`left_turret_yaw`** (caller, rotation about `y`, `-1.6..0.0`) /
  **`right_turret_yaw`** (caller, rotation about `y`, `0.0..1.6`) — traverse the
  two **side-mounted** turrets so each swings independently to cover only its
  own flank.
- **`radar_spin`** (auto, rotation about `y`, `-π..π`) — sweeps the decorative
  radar vane on its own forever via a looping clip; it keeps turning under both
  animations.

The case authors **two** review animations the viewer plays as buttons.
**`march`** (the walk) drives only the twelve leg joints in an
alternating-tripod gait — so a reviewer sees how the fortress strides when
spawned — while the guns hold still. **`bombardment`** (the guns) drives only
the four gun joints — the main cannon lobs forward while the side turrets sweep
their own flanks — while the legs hold planted. The `auto` radar keeps sweeping
through both. The model may add its own extra parts, joints, and clips on top,
but must not drop or contradict the required interface.

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
`rig.json` holding the required parts and joints (so the contract exists from
the first operation). There is no target model and no operations schema — the
binary's `--help` is the contract.

## Variants

The Aegis ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's
single `fidelity` scoring domain; it adds no specs, review items, or domains of
its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-aegis/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version
folders.
