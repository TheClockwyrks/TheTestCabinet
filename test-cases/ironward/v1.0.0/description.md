**Ironward Siege Tank** is a heavy tracked tank with a swiveling turret and a long
forward gun. This asset-generation case asks a model to sculpt *and rig* it as a
60×40×80 opaque-voxel model using only the `voxel-anim` tool, one operation at a
time: instead of a fixed rig, the model **paints discrete opaque cells** into a
shared volume to build each part, and defines its own skeleton. Crucially, the case
does **not** hand the model a rig: it fixes only the one animation the model must
author — a game-triggered **`turret_sweep`** that swings the turret through its full
traverse and loops — and leaves the parts, joints, and articulation that realize it
entirely to the model, so the test measures whether a model can work out the pieces a
tracked, turret-swiveling tank needs, attach them where they belong, and animate them
convincingly (a turret that swings as one solid piece about a single vertical axis, a
gun that rides its rotation and stays attached, a hull that stays put). The tank must
read unmistakably as the Ironward — a low, boxy hull on a pair of tracks, a turret on
top, and a long gun projecting forward — in the disciplined Ironward palette. There is
no target model — the model sculpts and rigs toward a written brief. The recorded
per-part operations are regenerated into a rigged 3D model the frontend renders with
the play-back animation, and a reviewer judges it against the brief: that it reads as a
tank, the turret swivels cleanly without detaching, the hull stays put, and the gun
stays attached to the turret.
