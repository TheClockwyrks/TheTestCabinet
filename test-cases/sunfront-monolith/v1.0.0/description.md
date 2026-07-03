**Sunfront Monolith** is a towering super-heavy bipedal Duneforged war-mech
carrying a giant cannon on its right arm. This asset-generation case asks a model
to sculpt *and rig* it as a 64×80×56 opaque-voxel model using only the
`voxel-anim` tool, one operation at a time: a massive brass torso and head (the
fixed root), two thick iron legs planted beneath the hips, and a giant arm-cannon
carried at the right shoulder. The rig's required, game-facing contract is a
caller-driven **`weapon_pitch`** joint — a rotation that aims the arm-cannon up
and down about its shoulder mount — plus a required **`walk`** animation the model
authors as F-curves, striding the two independent, three-segment (thigh-shin-foot)
legs in a slow, heavy, planted opposite-phase gait, and a weapon-only **`fire`**
recoil. There is no target model — the model sculpts, rigs, and animates toward
a written brief, and may add its own extra parts, joints, and animations on top.
The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with a live `weapon_pitch` control and the produced `walk` and
`fire` animations, and a reviewer judges it against the brief: that it reads as
a
super-heavy war-mech, the legs stride with a planted, weight-carrying gait, the
cannon pitches on the correct hinge without detaching, the torso stays fixed, and
the leg chains and cannon stay attached are what they weigh.
