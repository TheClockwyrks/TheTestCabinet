**Siege Warden Rifleman** is the standard-issue infantry soldier of the Warden
squad in *Siege* — the plain-Cobalt, balanced damage dealer that the machine
gunner, medic, and engineer all derive from. This asset-generation case asks a
model to build *and rig* it in **Blender**: authoring a single Blender Python
script (`build.py`) that constructs one skinned mesh, an armature it invents, the
skin weights that bind them, and one Action per required animation, then runs it
headless through `tcab-blend` to emit a rigged, animated **glTF 2.0** character a
game poses at runtime.

This is the first **Blender-authored** test case, and that is what makes it hard.
Unlike the CSG/signed-distance-field skinned kinds, there is no field to composite
— the model works in a real character pipeline (`bpy` meshes, edit-bone armatures,
vertex-group weights, F-curve Actions) and is judged on the *emitted glTF*, not on
the steps it took. The soldier's permanently-worn kit — combat helmet, light vest,
ammo pouches — must be **baked into the same mesh** and skinned to the same
skeleton, while the **weapon is left out entirely**: the rig carries an empty
`weapon_socket` bone parented to the right hand where the game hangs a separate
rifle asset.

Crucially, the case does **not** hand the model a rig. It fixes only the six
animations the model must author — a looping **`idle`** and **`run`**, and one-shot
**`fire`**, **`reload`**, **`hit`**, and **`death`** (which holds its last pose) —
and leaves the bones, joints, and weights entirely to the model. There is no target
model; the Rifleman is built toward a written brief in the disciplined Warden
Cobalt palette. Validation decodes the emitted `character.glb` (a skin is present
and every required animation is there and animating) and **re-runs `build.py`** to
confirm it reproduces the same character, then a reviewer judges it against the
brief: that it reads as a Warden Rifleman and deforms convincingly across its
joints. The finished models feed the Siege squad.
