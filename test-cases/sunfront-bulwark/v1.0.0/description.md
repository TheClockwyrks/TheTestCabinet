**Sunfront Bulwark** is a heavy bipedal Duneforged war-mech that braces a broad
tower shield on its left arm and swings a heavy siege maul in its right, striding
forward on two legs. This asset-generation case asks a model to sculpt *and rig* it
as a 56×68×48 opaque-voxel model using only the `voxel-anim` tool, one operation at
a time: instead of a fixed skeleton, the model **paints discrete opaque cells** into
whatever parts it invents — a broad, armored body and head with two shoulders, the
braced left shield arm, two legs on bent knees, and a right arm gripping the maul.
Crucially, the case does **not** hand the model a rig: it fixes only the two
animations the model must author — a walking **`walk`** and a weapon **`smash`** —
and leaves the parts, joints, and articulation that realize them entirely to the
model, so the test measures whether a model can work out the pieces a walking,
smashing mech needs, attach them where they belong, and animate them convincingly
(legs that plant a flat foot and push the body forward, a maul arm that winds up and
smashes without detaching). There is no target model — the model sculpts and rigs
toward a written brief, and may add its own extra parts, joints, and animations on
top. The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the play-back animations, and a reviewer judges it against the
brief: that it reads as a two-armed heavy mech with a shield and a maul, the maul arm
smashes on the correct hinge without detaching, the legs stride with a planted stance
instead of flailing, the body stays put, and every limb stays attached as it moves.
