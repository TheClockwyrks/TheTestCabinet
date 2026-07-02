**Sunfront Flakhound** is a four-legged Duneforged anti-air walker with a
traversing back turret and twin elevating flak barrels. This asset-generation case
asks a model to sculpt *and rig* it as a 52×48×56 opaque-voxel model using only
the `voxel-anim` tool, one operation at a time: a squat brass armored body (the
fixed
root), two banks of iron legs down its flanks, an iron turret on its back, and a
pair of flak barrels out front of the turret. The rig's required, game-facing
contract is two caller-driven joints — **`turret_yaw`**, a rotation that traverses
the turret (and the barrels with it) a full half-turn each way about its mount,
and **`barrel_pitch`**, a rotation that elevates the twin barrels toward the
sky — while the two leg banks scuttle on their own through the auto-driven
**`legs_left_scuttle`** and **`legs_right_scuttle`** joints, stepping in opposite
phase. There is no target model — the model sculpts and rigs toward a written
brief, and may add its own extra parts and joints on top. The recorded per-part
operations are regenerated into a rigged 3D model the frontend renders with live
`turret_yaw` and `barrel_pitch` controls and a `flak_track` animation, and a
reviewer judges it against the brief: that it reads as an anti-air walker, the
turret traverses and the barrels elevate on the correct pivots without detaching,
the body stays fixed, and the legs and turret stay attached are what they weigh.
