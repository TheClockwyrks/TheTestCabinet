**Sunfront Monolith** is a towering super-heavy bipedal Duneforged war-mech
carrying a giant cannon on its right arm. This asset-generation case asks a model
to sculpt *and rig* it as a 64×80×56 opaque-voxel model using only the
`voxel-anim` tool, one operation at a time: a massive brass torso and head (the
fixed root), two thick iron legs planted beneath the hips, and a giant arm-cannon
carried at the right shoulder. The rig's required, game-facing contract is a
caller-driven **`weapon_pitch`** joint — a rotation that aims the arm-cannon up
and down about its shoulder mount — while the two legs walk on their own through
the auto-driven **`leg_left_stride`** and **`leg_right_stride`** joints, striding
in opposite phase. There is no target model — the model sculpts and rigs toward
a written brief, and may add its own extra parts and joints on top. The recorded
per-part operations are regenerated into a rigged 3D model the frontend renders
with a live `weapon_pitch` control and a `fire` animation, and a reviewer judges
it against the brief: that it reads as a super-heavy war-mech, the cannon pitches
on the correct hinge without detaching, the torso stays fixed, and the legs and
cannon stay attached are what they weigh.
