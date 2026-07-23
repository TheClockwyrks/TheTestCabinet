# Sunfront Lancer — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Lancer** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a tall bipedal Duneforged marksman-mech — one with a heavy rail-lance
cannon **mounted on one shoulder**, a turret bolted to its frame — as a 32×50×50
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-lancer` is the catalog slug for this case. It is one of the `sunfront-*`
Duneforged voxel roster and shares the faction's brass-and-sandstone palette and
solar-amber team accent. There is no target model — the model builds toward the
seeded brief and is reviewed subjectively against it.

## The contract

The case does **not** prescribe a rig. Its `test-case.toml` `[model]` table fixes
only the two animations the model must author (by name); the model **invents**
whatever parts and joints the mech needs and is judged on whether it works out the
right pieces, attaches them where they belong, and animates them convincingly. This
measures creativity and craft, not instruction-following.

The two required, model-authored animations (declarations only — the model authors
the F-curves) are both game-triggered playables (`auto_play = false`):

- **`walk`** — the walk: the two legs stride in opposite phase, each foot planting
  flat and still on the ground then lifting clear, swinging forward, and planting
  again with weight, so the mech pushes itself forward rather than flailing. The
  legs move; the shoulder-mounted cannon holds steady.
- **`fire`** — the weapon showcase: the whole cannon kicks straight back along its own
  axis in its shoulder mount (a sharp recoil, an overshoot, and a settle), the mount and
  frame taking the shock, while the legs hold their stance.

The weapon is **frame-mounted, not held**: a long rail-cannon seated on a structural
turret mount (a trunnion cradle or pintle yoke) bolted to one shoulder, reading as
machinery built onto the chassis — no hand, no gripping arm. This deliberately sets the
Lancer apart from the arm-wielded mechs of the roster (the Sentinel's right-arm rifle,
the Monolith's right-arm cannon, the Bulwark's held maul). The mech is asymmetric above
the waist (only the legs mirror), and the barrel clears the hull through its full
elevation.

The model may add its own extra parts, joints, and animations on top, but must not
drop or contradict these two required animations.

## Contents

| Path             | Seeded to run? | Purpose                                                    |
| ---------------- | -------------- | ---------------------------------------------------------- |
| `specs/brief.md` | **Yes**        | The self-contained sculpting-and-rigging brief.            |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.              |
| `test-case.toml` | No             | Manifest: voxel volume, tool, output, animations, review.  |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).          |
| `description.md` | No             | Site blurb.                                                |
| `README.md`      | No             | This overview.                                             |

A run receives the seeded brief, the `voxel-anim` binary, and a pre-seeded
`rig.json` holding the two required animation declarations — no parts and no joints
(so the animation contract exists from the first operation, and the model invents
the skeleton). There is no target model and no operations schema — the binary's
`--help` is the contract.

## Variants

The Lancer ships three size variants: **`base`** (the case's 32×50×50 volume, the
default), **`half`** (each extent ~halved, 16×25×25), and **`double`** (each doubled,
64×100×100). Each declares its own `[voxel]` override and renders the brief at those
dimensions; all share the single `overall` scoring domain.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-lancer/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
