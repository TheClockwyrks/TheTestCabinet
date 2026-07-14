# Sunfront Aegis — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Aegis** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a colossal Duneforged **multi-legged walking fortress** — a
tiered, prowed multi-gun war-fortress that dwarfs every buildable unit and
strides on legs — as a 120×110×150 opaque-voxel model using only the `voxel-anim`
tool, one recorded operation at a time, authoring its walk and weapon animations
as F-curves.

`sunfront-aegis` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-bronze
palette and solar-amber team accent. There is no target model — the model builds
toward the seeded brief and is reviewed subjectively against it.

## The contract

This case does **not** hand the model a rig. The brief fixes only *what the Aegis
is* (a colossal armored citadel raised on walking legs, a big main turret with a
dominant forward cannon, a side-mounted turret out on each flank, and a decorative
radar vane that sweeps on its own — in the Duneforged palette with a solar-amber
accent) and *how it must move*. **The parts, joints, pivots, and articulation are
entirely the model's to invent** — the test measures whether it can work out the
pieces a walking, firing fortress needs, attach them where they belong, and
animate them convincingly. The model defines its own parts and joints through the
`voxel-anim` rig subcommands.

The one fixed part of the rig is the set of **three required animations**, declared
in `test-case.toml`'s `[model]` table as name + `loop` + `auto_play` only (no
parts, joints, or keyframes); the model authors their F-curves at run time with
`voxel-anim define-animation` / `add-keyframe`:

- **`march`** (`auto_play = false`) — the WALK: a game-triggered playable that
  strides the fortress forward on its legs with a planted, flat, still stance
  phase, so a reviewer sees how it walks.
- **`bombardment`** (`auto_play = false`) — the WEAPON showcase: a game-triggered
  playable that works the main cannon (aiming forward and elevating) and the two
  side turrets (each covering its own flank) while the fortress stands its ground.
- **`radar_spin`** (`auto_play = true`) — the decorative self-playing radar sweep,
  turning on its own under both playables and at idle.

The model may add its own extra parts, joints, and animations on top, but must
produce these three animations by these names and must not contradict them.

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
`rig.json` holding the required animation declarations (so the contract exists
from the first operation). There is no target model and no operations schema — the
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
