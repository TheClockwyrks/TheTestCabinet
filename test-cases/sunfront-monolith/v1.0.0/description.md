**Sunfront Monolith** is a towering super-heavy bipedal Duneforged war-mech
carrying a giant cannon on its right arm.

This asset-generation case asks a model to sculpt *and rig* it as a 64×80×56
opaque-voxel model using only the `voxel-anim` tool, one operation at a time: a
massive brass torso and head, two thick iron legs planted beneath the hips, and a
giant arm-cannon carried at the right shoulder. Crucially, the case does **not**
hand the model a rig: it fixes only the two animations the model must author as
F-curves — a slow, heavy, planted opposite-phase **`walk`** that strides the two
legs, and a weapon-only **`fire`** recoil — and leaves the parts, joints, and
articulation that realize them entirely to the model.

So the test measures whether a model can work out the pieces a walking, firing
mech needs, attach them where they belong, and animate them convincingly: legs
that plant a flat foot and push the body forward, and a cannon that aims and
recoils without detaching. There is no target model: the model sculpts, rigs, and
animates toward a written brief.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the produced `walk` and `fire` animations, and a reviewer
judges it against the brief: that it reads as a super-heavy war-mech, the legs
stride with a planted, weight-carrying gait, the cannon pitches and recoils on the
correct hinge without detaching, the torso stays fixed, and the legs and cannon
stay attached while only the moving parts move.
