**Sunfront Bulwark** is a heavy bipedal Duneforged war-mech that braces a broad
tower shield on its left arm and swings a heavy siege maul in its right. This
asset-generation case asks a model to sculpt *and rig* it as a 56×68×48
opaque-voxel model using only the `voxel-anim` tool, one operation at a time: a
broad, armored brass torso and head with two shoulders and the braced left shield
arm (the fixed root), two thick legs planted beneath the hips, and a right arm
gripping the maul. The rig's required, game-facing contract is a caller-driven
**`weapon_pitch`** joint — a rotation that winds the right maul arm up over the
head and smashes it down about its shoulder hinge — while the two legs walk on
their own through the auto-driven **`leg_left_stride`** and **`leg_right_stride`**
joints, striding in opposite phase. There is no target model — the model sculpts
and rigs toward a written brief, and may add its own extra parts and joints on
top. The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with a live `weapon_pitch` control and a `smash` maul animation,
and a reviewer judges it against the brief: that it reads as a two-armed heavy
mech with a shield and a maul, the maul arm smashes on the correct hinge without
detaching, the torso stays fixed, and the legs and maul arm stay attached are what
they weigh.
