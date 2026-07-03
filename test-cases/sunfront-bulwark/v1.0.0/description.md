**Sunfront Bulwark** is a heavy bipedal Duneforged war-mech that braces a broad
tower shield on its left arm and swings a heavy siege maul in its right. This
asset-generation case asks a model to sculpt *and rig* it as a 56×68×48
opaque-voxel model using only the `voxel-anim` tool, one operation at a time: a
broad, armored brass torso and head with two shoulders and the braced left shield
arm (the fixed root), two independent three-segment legs (thigh, shin, flat foot)
standing on bent knees beneath the hips, and a right arm gripping the maul. The
rig's required, game-facing contract is a caller-driven **`weapon_pitch`** joint
—
a rotation that winds the right maul arm up over the head and smashes it down about
its shoulder hinge — plus six `auto` leg joints (a `hip_*`, a reverse-folding
`knee_*`, and a flat `foot_*` per leg) and two model-authored animations: a
**`walk`** the model builds as F-curves — a real biped gait with a planted stance
phase, the legs striding in opposite phase — and a **`smash`**. There is no target
model — the model sculpts and rigs toward a written brief, and may add its own
extra parts, joints, and animations on top. The recorded per-part operations are
regenerated into a rigged 3D model the frontend renders with a live `weapon_pitch`
control and the model's `walk` and `smash` animations, and a reviewer judges it
against the brief: that it reads as a two-armed heavy mech with a shield and a
maul, the maul arm smashes on the correct hinge without detaching, the legs stride
with a planted stance instead of flailing, the torso stays fixed, and every part
stays attached are what they weigh.
