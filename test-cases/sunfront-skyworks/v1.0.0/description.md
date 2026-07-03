**Sunfront Skyworks** is a broad Duneforged launch-pad hangar with a fast
spinning turbine and a raising launch door. This asset-generation case asks a
model to sculpt *and rig* it as a 64×64×64 opaque-voxel model using only the
`voxel-anim` tool, one operation at a time: an open brass masonry pad (the fixed
root) with a center mast, an iron turbine spinning high on that mast, and a
launch door set in its front face. The rig's required contract is two auto-driven
joints — a **`turbine_spin`** rotation that turns the turbine a full revolution,
and a **`launch_door_raise`** translation that slides the door up and back
down — so the Skyworks runs on its own while the `base` stays fixed. There is no
target model — the model sculpts and rigs toward a written brief, and may add
its own extra parts and joints on top. The recorded per-part operations are
regenerated into a rigged 3D model the frontend renders with the turbine and door
cycling on their auto-play animations, and a reviewer judges it against the
brief: that it reads
as a launch-pad hangar, the turbine spins and door raises on the correct axes
without detaching, the base stays fixed, and the turbine and door stay attached
are what they weigh.
