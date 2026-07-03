**Sunfront Lancer** is a tall bipedal Duneforged marksman-mech carrying a long
center rail-lance. This asset-generation case asks a model to sculpt *and rig* it
as a 44×64×64 opaque-voxel model using only the `voxel-anim` tool, one operation
at a time: an upright brass-and-sandstone torso (the fixed root), two independent
three-segment iron legs (thigh, shin, and a short flat foot, with a bent knee)
beneath the hips, and a slender rail-lance projecting forward from the chest.
The rig's required, game-facing contract is a caller-driven **`weapon_pitch`**
joint — a rotation that aims the rail-lance up and down about its chest mount —
plus six auto leg joints (a hip, knee, and ankle per leg) the model drives with
a
required, model-authored **`walk`** animation, the two legs striding in opposite
phase with a planted stance phase and an eased foot-plant. There is no target
model — the model sculpts and rigs toward a written brief, and may add its own
extra parts, joints, and animations on top. The recorded per-part operations are
regenerated into a rigged 3D model the frontend renders with a live `weapon_pitch`
control and playable `walk` and `fire` animations, and a reviewer judges it against
the brief: that it reads as a rail-lance marksman, the lance aims on the correct
mount without detaching, the legs stride independently without clipping the ground,
the torso stays fixed, and the legs and lance stay attached are what they weigh.
