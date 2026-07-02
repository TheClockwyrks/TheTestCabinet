**Sunfront Aegis** is a tall, broad two-legged Duneforged guardian mech that
carries a huge tower-shield on its left arm. This asset-generation case asks a
model to sculpt *and rig* it as a 64×76×56 opaque-voxel model using only the
`voxel-anim` tool, one operation at a time: an armored sandstone torso and head
(the fixed root), two thick iron legs, and a great tower-shield on the left
shoulder. The rig's required, game-facing contract is a caller-driven
**`weapon_pitch`** joint — a rotation that raises and lowers the tower-shield
about its shoulder mount — while the two legs walk on their own through the
auto-driven **`leg_left_stride`** and **`leg_right_stride`** joints, stepping in
opposite phase. There is no target model — the model sculpts and rigs toward a
written brief, and may add its own extra parts and joints on top. The recorded
per-part operations are regenerated into a rigged 3D model the frontend renders
with a live `weapon_pitch` control and a `guard` animation, and a reviewer judges
it against the brief: that it reads as a shield-bearing guardian, the shield
raises on the correct shoulder axis without detaching, the torso stays fixed, and
the legs and shield stay attached are what they weigh.
