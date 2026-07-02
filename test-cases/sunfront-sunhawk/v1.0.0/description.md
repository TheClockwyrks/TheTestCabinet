**Sunfront Sunhawk** is a wide, flat Duneforged gunship aircraft with two
spinning rotors and an underslung forward cannon. This asset-generation case asks
a model to sculpt *and rig* it as a 64×36×64 opaque-voxel model using only the
`voxel-anim` tool, one operation at a time: a broad brass fuselage (the fixed
root), a rotor out on each wing stub, and an iron cannon beneath the nose. The
rig's required, game-facing contract is a caller-driven **`cannon_pitch`**
joint — a rotation that tilts the underslung cannon up and down about its
mount — while the two rotors spin on their own through the auto-driven
**`rotor_left_spin`** and **`rotor_right_spin`** joints. There is no target
model — the model sculpts and rigs toward a written brief, and may add its own
extra parts and joints on top. The recorded per-part operations are regenerated
into a rigged 3D model the frontend
renders with a live `cannon_pitch` control and a `strafe` animation, and a
reviewer judges it against the brief: that it reads as a gunship, the cannon aims
on the correct mount without detaching, the hull stays fixed, and the rotors and
cannon stay attached are what they weigh.
