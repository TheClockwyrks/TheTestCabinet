**Ironward Siege Tank** is a heavy tracked tank with a swiveling turret and a
long forward gun.

This asset-generation case asks a model to sculpt and rig it as a 40×30×80
opaque-voxel model using only the `voxel-anim` tool, one operation at a time.
The model paints discrete opaque cells into a shared volume to build each part
and defines its own skeleton. The fixed contract is a single animation it must
author, a game-triggered `turret_sweep` that swings the turret through its full
traverse and loops; the parts, joints, and articulation that realize it are the
model's to work out.

The tank must read unmistakably as the Ironward: a low, boxy hull on a pair of
tracks, a turret on top, and a long gun projecting forward, in the disciplined
Ironward palette. There is no target model, so the model sculpts and rigs toward
a written brief.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the play-back animation. A reviewer judges it against the
brief: that it reads as a tank, that the turret swings cleanly as one solid
piece about a single vertical axis and stays attached, that the gun rides that
rotation and stays attached, and that the hull stays put.
