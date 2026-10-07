**Siege Rifleman** is the standard-issue infantry soldier of the Warden
squad in Siege, the plain-Cobalt, balanced damage dealer that the machine gunner,
medic, and engineer all derive from. It is the first Blender-authored test case.

This asset-generation case asks a model to build and rig the soldier in Blender
by authoring a single Blender Python script (`build.py`) that constructs one
skinned mesh, an armature it invents, the skin weights that bind them, and one
Action per required animation. Running that script headless through `tcab-blend` emits a
rigged, animated glTF 2.0 character a game poses at runtime. The model works in
a real character pipeline of `bpy` meshes, edit-bone armatures, vertex-group
weights, and F-curve Actions, and is judged on the emitted glTF. Unlike the
CSG/signed-distance-field skinned kinds, there is no field to composite.

The soldier's permanently-worn kit of combat helmet, light vest, and ammo
pouches is baked into that same mesh and skinned to the same skeleton. The
weapon is left out entirely: the rig carries an empty `weapon_socket` bone
parented to the right hand, where the game hangs a separate rifle asset.

The case fixes only the six animations the model must author, a looping `idle`
and `run` plus one-shot `fire`, `reload`, `hit`, and `death`, which holds its
last pose. The bones, joints, and weights are the model's to invent. There is no
target model; the Rifleman is built toward a written brief in the disciplined
Warden Cobalt palette.

Validation decodes the emitted `character.glb` to confirm a skin is present and
every required animation is there and animating, then re-runs `build.py` to
confirm it reproduces the same character. A reviewer judges the result against
the brief: that it reads as a Warden Rifleman and deforms convincingly across
its joints. The finished models feed the Siege squad.
