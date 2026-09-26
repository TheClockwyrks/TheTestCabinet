# Siege Rifleman — `v1.0.0`

This is version `v1.0.0` of the **Siege Rifleman** test case: an
asset-generation case (`asset_kind = "blender-character"`) that asks a model to
build and rig the Warden squad's standard-issue infantry soldier, an upright
humanoid, as a skinned, animated character in Blender, by authoring a single
Blender Python script and running it headless. It is the first Blender-authored
test case in the repo.

`siege-rifleman` is the catalog slug for this case. The Rifleman is the base
body of the Siege squad, the plain-Cobalt, balanced damage dealer (`HP 90`,
hitscan rifle) that the machine gunner, medic, and engineer are variations on.
There is no target model: the model builds toward the seeded brief and is
reviewed subjectively against it.

## Blender-authored, not CSG-sculpted

This is a skinned character, one continuous skin bound to a skeleton and
deforming across its joints, authored through a real character pipeline rather
than the CSG/signed-distance-field skinned kinds (`mc-skin`, `sn-skin`,
`dc-skin`). The run container ships headless Blender plus a thin runner,
`tcab-blend`, and a bundled glTF export helper. The model:

- Writes `build.py`, a Blender (`bpy`) script that builds the body mesh, an
  armature of edit-bones in a hierarchy, the skin weights as vertex groups,
  capped and normalized, and one Action per required animation.
- Runs `tcab-blend`, which execs
  `blender --background --python build.py -- <config.json>`. This is the only
  sanctioned build path. There is no operation log; `build.py` is the recorded
  authoring trace.
- The export helper emits `character.glb`, a skinned and animated glTF 2.0, and
  renders the preview `model.png`. Both are the emitted output, and neither is
  declared in the manifest.

Because the character is one mesh, `[tool].preview` (`model.png`) and
`[output].actions` (`build.py`) are single files with no `{part}` token.

## The gear is baked in; the weapon is a socket

The soldier is built as one skinned mesh: the body plus its permanently-worn kit
of combat helmet, light vest / body armor, and ammo pouches, baked into that
same mesh and skinned to the same skeleton, so the gear rides and deforms with
the soldier.

The rifle is left to the game. The rig carries an empty `weapon_socket` bone
parented to the right hand with no vertex influence, an attach point where the
game hangs a separate rifle asset. The `fire` and `reload` animations move the
hands and this socket, and the game supplies the gun. This matches the repo's
standard skinned-character socket convention.

## The rig

The case prescribes no rig. The `[model]` table in `test-case.toml` fixes only
the animations the model must author, by name; the model invents whatever bones,
joints, and weights an upright, running, firing soldier needs and is judged on
whether its one continuous skin deforms convincingly. Each required animation is
a declaration only, a `name`, a `loop` flag, and an `auto_play` flag, and the
model lays down the F-curve keyframes in a Blender Action at run time. The six
required animations are:

- `idle` (loop, auto-play) — a settled, breathing ready stance: weight on both
  feet, a slow chest rise-and-fall and small weight shift so the soldier reads
  as alive while standing.
- `run` (loop) — a real run cycle authored in place: planted feet, legs in
  opposite phase, arms counter-swinging, the torso leaning into the run. The leg
  cycle carries the stride and a game supplies the travel.
- `fire` (play once) — shoulder the socketed weapon, brace, and take a single
  shot whose recoil kicks back through the shoulder and torso and settles, while
  the legs hold planted.
- `reload` (play once) — the hands work at the weapon and socket: drop, swap,
  seat, chamber, back to the ready aim.
- `hit` (play once) — a sharp flinch / stagger from an impact that recovers to
  the stance.
- `death` (play once, holds the last pose) — the legs buckle, the spine folds,
  the body collapses and holds limp on the ground.

The model may add its own extra bones, joints, and animations on top, and must
keep all six required animations intact. A game plays these clips by name,
triggering `reload` or `fire` on demand, native to the emitted glTF.

## The runtime interface

Beyond the clips, the case fixes the procedural interface a game drives. Both
parts of it travel in the emitted glTF as node `extras`, written as Blender
custom properties and exported with `export_extras`, so there is no sidecar
file:

- `aim_pitch` — a required `[[model.joint]]` caller DOF, the runtime-drivable
  joint a game sets each frame to pitch the soldier's aim up and down, a
  rotation about the glTF-frame `x` axis of ±40°. The model builds an aim bone
  in the upper spine/chest, carrying the head, arms, and weapon socket, and tags
  it `tcab_joint`, so a game finds it by name and clamps it. In the review
  viewer a slider aims it live.
- `weapon_socket` — the empty attach bone on the right hand, tagged
  `tcab_socket`, so a game discovers the mount point by name and hangs a
  separate rifle there.

## Palette

The disciplined Warden palette (from Siege's `specs/overview.md`): Warden Cobalt
`#3d7bd6` and Cobalt light `#7fb0f0` carry the read, with gunmetal `#565c64`,
dark iron `#2b2f36`, and charcoal-slate `#3a4048` for fittings and recesses, and
a pale-cobalt visor glow `#bfe0ff`. These are the only colors allowed.

## Contents

| Path             | Seeded to run? | Purpose                                                        |
| ---------------- | -------------- | -------------------------------------------------------------- |
| `specs/brief.md` | Yes            | The self-contained modeling-and-rigging brief.                 |
| `specs/build.py` | Yes            | The starter Blender script the model edits (seeded as a spec). |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.                  |
| `test-case.toml` | No             | Manifest: bounds, tool, output, the rig, and review.           |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).              |
| `description.md` | No             | Site blurb.                                                    |
| `README.md`      | No             | This overview.                                                 |

A run receives the seeded brief and the seeded starter `build.py`, plus headless
Blender and `tcab-blend` on its `PATH` and a pre-seeded `blender.config.json`.
That config carries the bounding box, the Blender-native authoring axes of +Z up
and facing -Y, which the export converts to the family's +Y-up/+Z-forward glTF,
the output paths, and the required animation names. The skeleton and its binding
are the model's to invent, and there is no target model.

## How it's validated

The `character.glb` the run emits is the authoritative output. Validation is
emitted-file authoritative, with no op-replay:

1. `character.glb` exists and is a well-formed GLB.
2. It carries a skin and at least one mesh, so a skinned character is present.
3. The glTF `animations` are reconciled against the required clip set. Each
   required animation must be present and actually animating; a gap is recorded
   as a zero-scored contract note rather than crashing the run.
4. The caller DOFs are reconciled. Each required `[[model.joint]]` (`aim_pitch`)
   must be exposed as a node whose `extras.tcab_joint` carries that name with
   the right kind and axis, so a game can find and drive it. A missing or
   mis-typed DOF is a recorded contract note, and is not gated.
5. Provenance re-run: `tcab-blend` is re-run on the seeded `build.py` in a clean
   environment and the re-exported glb's summary of animation-name set,
   caller-DOF set, and mesh / skin counts is compared to the run's
   `character.glb`. Divergence is a recorded note, the Blender analogue of the
   sprite kinds' cheat-divergence, and the step degrades gracefully if the
   runner or Blender is absent.

The emitted glTF is rendered and posed in the browser by linear-blend skinning.
The reviewer plays each clip, drives the `aim_pitch` DOF with a slider to aim
the soldier live as a game would, and judges it against the brief.

## Variants

The Rifleman ships a single default variant, `base`, declared in
`variants/base.toml`. It seeds the common brief and starter script and is rated
on the case's single `overall` scoring domain; it adds no specs or domains of
its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/siege-rifleman/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version
folders.
