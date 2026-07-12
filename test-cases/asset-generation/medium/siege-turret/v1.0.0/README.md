# Siege Warden Turret — `v1.0.0`

This is version `v1.0.0` of the **Siege Warden Turret** test case: an
asset-generation case (`asset_kind = "blender-mechanism"`) that asks a model to
build *and rig* an automated Warden defense emplacement — a fixed mount, a rotating
housing, and an elevating gun — as a **rigidly-articulated, animated mechanism** in
**Blender**, by authoring a single Blender Python script and running it headless. It
is the first **`blender-mechanism`** (rigid Blender) case in the repo.

`siege-turret` is the catalog slug for this case. There is no target model — the
model builds toward the seeded brief and is reviewed subjectively against it.

## A rigid mechanism, not a skinned character

This is the **rigidly-articulated** member of the Blender family. Where the
[`blender-character`](../../../hard/siege-rifleman/) kind builds one continuous skin
that **deforms** across its joints, a **`blender-mechanism`** moves as **separate
rigid parts pivoting about their joints** — the wooden-puppet read that is exactly
right for a turret. It is authored through the same channel: the run container ships
**headless Blender** plus the **`tcab-blend`** runner and a bundled glTF export
helper. The model:

- Writes **`build.py`**, a Blender (`bpy`) script that builds the turret as
  **separate mesh objects**, **parents** them into a hierarchy (base → yaw housing →
  elevating gun → barrels), and authors one **Action** per required animation keying
  the part objects' **transforms** (rotation / location) — **not** an armature and
  skin weights.
- Runs **`tcab-blend`**, which execs `blender --background --python build.py --
  <config.json>`. This is the **only** sanctioned build path. There is no operation
  log — **`build.py` is the recorded authoring trace**.
- The export helper emits **`model.glb`** (a native glTF 2.0 whose motion is baked
  as standard **node-hierarchy animations** — no skin) and renders the preview
  **`model.png`**. Both are the emitted output; they are not declared in the
  manifest. The output is a **native game format**, not a Test-Cabinet-specific one
  like `rig.json`.

Because the mechanism is emitted as one glTF, `[tool].preview` (`model.png`) and
`[output].actions` (`build.py`) are **single files** — no `{part}` token.

## The rig — two game-facing contracts

The case does **not** prescribe the parts, pivots, or shapes: the model invents the
articulated hierarchy and is judged on whether it moves convincingly as a rigid
mechanism. What the `[model]` table fixes is the **game-facing interface**, in two
parts — the clips a game *plays* and the DOFs a game *drives*.

**Animation clips** (`[[model.animation]]`) — baked node-hierarchy Actions a game
triggers by name, authored on object transforms:

- **`deploy`** (play once) — the turret comes **online** from a stowed rest: the
  housing rises / unfolds and the gun elevates to a ready, level firing attitude.
- **`fire`** (play once) — the barrels **recoil** back along their axis and return,
  with a small muzzle rise that settles.
- **`stow`** (play once, **holds** the last pose) — the reverse of `deploy`: the gun
  packs down and the housing folds back to the stowed rest, and holds it.

**Caller DOFs** (`[[model.joint]]`) — the runtime-drivable joints a game **sets each
frame from its own state to AIM the turret**. The model builds the driven node and
tags it with a `tcab_joint` Blender custom property, which the export writes into that
node's glTF `extras` (three.js reads it as `userData`) — so the interface travels
**inside the emitted glTF** (no sidecar, no custom extension) and a game finds the node
by name and clamps to its limits:

- **`turret_yaw`** — rotation about the vertical (`y`, glTF-frame) axis, ±170°: the
  housing (and the gun it carries) traverses to aim.
- **`barrel_pitch`** — rotation about a horizontal (`x`) axis, −10°…60°: the gun
  elevates to aim up/down.

A caller DOF is **not** animated by a clip — the game owns the aim; the clips move the
housing rise, barrel recoil, and packing. In the browser review the two contracts are
both exercised: the animation picker plays the clips, and a slider per caller DOF aims
the turret live. The model may add its own extra parts, clips, and DOFs on top, but
must not drop the required ones.

## Palette

The disciplined Warden palette (from Siege's `specs/overview.md`): Warden Cobalt
`#3d7bd6` and Cobalt light `#7fb0f0` carry the housing, with gunmetal `#565c64`
(gun, barrels, mount), dark iron `#2b2f36` (base, recesses), and charcoal-slate
`#3a4048` (bracing) for structure, and a pale-cobalt sensor glow `#bfe0ff`. These
are the only colors allowed.

## Contents

| Path             | Seeded to run? | Purpose                                                        |
| ---------------- | -------------- | -------------------------------------------------------------- |
| `specs/brief.md` | **Yes**        | The self-contained modeling-and-rigging brief.                 |
| `specs/build.py` | **Yes**        | The starter Blender script the model edits (seeded as a spec). |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.                  |
| `test-case.toml` | No             | Manifest: bounds, tool, output, the animations, and review.    |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).              |
| `description.md` | No             | Site blurb.                                                    |
| `README.md`      | No             | This overview.                                                 |

A run receives the seeded brief and the seeded starter `build.py`, plus headless
Blender and `tcab-blend` on its `PATH` and a pre-seeded `blender.config.json`
(the bounding box, the Blender-native authoring axes — +Z up, facing -Y, which the
export converts to the family's +Y-up/+Z-forward glTF — the output paths, and the
required animation names). The parts and their motion are the model's to invent;
there is no target model.

## How it's validated

The `model.glb` the run emits is the authoritative output. Validation is
**emitted-file authoritative** — there is no op-replay:

1. `model.glb` exists and is a well-formed GLB.
2. It carries at least one **mesh** (a model is present). A mechanism is **not**
   required to carry a skin (it is rigid, articulated by its node hierarchy).
3. The glTF `animations` are **reconciled** against the required clip set — each
   required animation must be present and actually animating; a gap is recorded as a
   zero-scored contract note rather than crashing the run.
4. The **caller DOFs** are reconciled: each required `[[model.joint]]` must be exposed
   as a node whose `extras.tcab_joint` carries that name with the right kind and axis,
   so a game can find and drive it. A missing or mis-typed DOF is a recorded contract
   note (not gated).
5. **Provenance re-run**: `tcab-blend` is re-run on the seeded `build.py` in a clean
   environment and the re-exported glb's summary (animation-name set, caller-DOF set,
   mesh count) is compared to the run's `model.glb`; divergence is a recorded note (the
   Blender analogue of the sprite kinds' cheat-divergence), and it degrades gracefully
   if the runner or Blender is absent.

The emitted glTF is rendered in the browser: its baked node animations are scrubbed by
a native glTF player, and each caller DOF gets a slider that **aims the turret live**
(a game drives them the same way), so a reviewer judges both the clips and the runtime
aiming against the brief.

## Variants

The turret ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and starter script and is rated on
the case's scoring domains; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/.../siege-turret/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
