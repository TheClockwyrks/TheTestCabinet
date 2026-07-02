**Sunfront Lancer** is a tall bipedal Duneforged marksman-mech carrying a long
center rail-lance. This asset-generation case asks a model to sculpt *and rig* it
as a 44×64×64 opaque-voxel model using only the `voxel-anim` tool, one operation
at a time: an upright brass-and-sandstone torso (the fixed root), two iron legs
beneath the hips, and a slender rail-lance projecting forward from the chest.
The rig's required, game-facing contract is a caller-driven **`weapon_pitch`**
joint — a rotation that aims the rail-lance up and down about its chest mount —
while the two legs walk on their own through the auto-driven **`leg_left_stride`**
and **`leg_right_stride`** joints, striding in opposite phase. There is no target
model — the model sculpts and rigs toward a written brief, and may add its own
extra parts and joints on top. The recorded per-part operations are regenerated
into a rigged 3D model the frontend renders with a live `weapon_pitch` control
and a `fire` animation, and a reviewer judges it against the brief: that it reads
as a rail-lance marksman, the lance aims on the correct mount without detaching,
the torso stays fixed, and the legs and lance stay attached are what they weigh.
