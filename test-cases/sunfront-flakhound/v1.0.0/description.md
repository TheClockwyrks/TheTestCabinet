**Sunfront Flakhound** is a four-legged Duneforged anti-air walker with a
traversing back turret and twin elevating flak barrels. This asset-generation case
asks a model to sculpt *and rig* it as a 52×48×56 opaque-voxel model using only
the `voxel-anim` tool, one operation at a time: a squat brass armored body (the
fixed root), four independent iron legs (each a thigh, a shin, and a flat foot
on a
hip and a reverse knee) at its corners, an iron turret on its back, and a pair of
flak barrels out front of the turret. The rig's required, game-facing contract is
two caller-driven joints — **`turret_yaw`**, a rotation that traverses the turret
(and the barrels with it) a full half-turn each way about its mount, and
**`barrel_pitch`**, a rotation that elevates the twin barrels toward the sky — plus
twelve auto leg joints (a **`hip_*`**, a reverse **`knee_*`**, and a flat
**`foot_*`** per leg). The model must also **author two animations** as
weight-carrying F-curves: a **`walk`** that strides the legs in a diagonal-pair
gait with a planted, flat-footed stance, and a **`flak_track`** that sweeps the
turret while elevating the barrels. There is no target model — the model sculpts,
rigs, and animates toward a written brief, and may add its own extra parts, joints,
and animations on top. The recorded per-part operations are regenerated into a
rigged, animated 3D model the frontend renders with live `turret_yaw` and
`barrel_pitch` controls and playable `walk`/`flak_track` animations, and a reviewer
judges it against the brief: that it reads as an anti-air walker, the legs stride
independently without clipping the ground, the turret traverses and the barrels
elevate on the correct pivots without detaching, and the body stays fixed are what
they weigh.
