**Siege Warden Rifle** is the standard-issue weapon a Siege Warden rifleman
carries, the gunmetal service rifle that hangs on the soldier's hand socket.
This asset-generation case asks a model to build it in Blender as a static
hard-surface prop: authoring a single Blender Python script (`build.py`) that
constructs the whole rifle as clean geometry, then running it headless through
`tcab-blend` to emit a native glTF 2.0 model a game drops straight in.

This is a `blender-prop` case, the static member of the Blender family. The prop
carries no rig: no armature, no skin, and no animations. The model works in a
real hard-surface pipeline of `bpy` meshes and materials and is judged on the
emitted glTF. The output is a native, unrigged `model.glb`, exactly what a game
engine loads.

The case fixes only what the rifle is, a believable service rifle with a
receiver, barrel, handguard, stock, magazine, and sight, in the disciplined
Warden gunmetal-and-Cobalt palette. Every shape and proportion is the model's.
There is no target model; the rifle is built toward a written brief.

Validation decodes the emitted `model.glb` to confirm a well-formed glTF
carrying at least one mesh, then re-runs `build.py` to confirm it reproduces the
same model. A reviewer judges the result against the brief: that it reads
unmistakably as a service rifle and is a clean, deliberate hard-surface asset.
The rifle mounts on the [Warden Rifleman](../../hard/siege-rifleman/)'s empty
`weapon_socket`.
