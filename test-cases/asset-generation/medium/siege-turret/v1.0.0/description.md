**Siege Warden Turret** is an automated defense emplacement of the Warden faction in
*Siege* — a fixed mount, a rotating housing, and an elevating twin-barrel gun that
scans, deploys, fires, and stows. This asset-generation case asks a model to build
*and rig* it in **Blender**: authoring a single Blender Python script (`build.py`)
that constructs the turret as **separate parented parts** and animates it as
**object motion**, then runs it headless through `tcab-blend` to emit a rigged,
animated **glTF 2.0** a game poses and plays at runtime.

This is a **`blender-mechanism`** case — the rigidly-articulated member of the
Blender family. Unlike the skinned [Warden Rifleman](../../hard/siege-rifleman/),
which bends as one continuous skin, a mechanism moves as **separate rigid parts
pivoting about their joints** — the housing yaws, the gun elevates, the barrels
recoil, and nothing deforms. Crucially, the motion is emitted as **standard glTF
node-hierarchy animations** baked into the file — a **native** format a game plays
directly, **not** a Test-Cabinet-specific `rig.json`. The model works in a real
hard-surface / animation pipeline (`bpy` meshes, parented objects, F-curve Actions
on object transforms) and is judged on the *emitted glTF*, not on the steps it took.

The case does **not** hand the model a rig. It fixes the game-facing interface in two
parts and leaves the parts, pivots, and shapes to the model: the **animation clips** a
game plays (one-shot **`deploy`**, **`fire`**, and **`stow`**, which holds its packed
pose), and the **caller DOFs** a game drives to *aim* the turret at runtime
(**`turret_yaw`** traverse and **`barrel_pitch`** elevation), which the model exposes
by tagging the driven glTF node's `extras` so the interface travels in the file itself.
There is no target model; the turret is built toward a written brief in the disciplined
Warden palette. Validation decodes the emitted `model.glb` (a well-formed glTF whose
required clips animate and whose required DOFs are exposed with the right axis) and
**re-runs `build.py`** to confirm it reproduces the same turret, then a reviewer judges
it against the brief — that it reads as an automated defense turret, articulates as a
rigid mechanism, and can actually be aimed (a slider drives each DOF live in the
review viewer).
