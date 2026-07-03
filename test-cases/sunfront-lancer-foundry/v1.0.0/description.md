**Sunfront Lancer Foundry** is a tall, slender Duneforged spire with a sliding
rail-arm and a spinning focus-ring. This asset-generation case asks a model to
sculpt *and rig* it as a 44×84×44 opaque-voxel model using only the `voxel-anim`
tool, one operation at a time: a masonry base tower (the fixed root), a heavy iron
rail-arm set into the mid-shaft, and a machined focus-ring crowning the top. As
a structure it has no caller controls — both moving parts animate on their own
through auto joints: **`rail_arm_slide`** rides the arm up and down its shaft,
while **`focus_ring_spin`** turns the ring a full revolution, each driven by a
looping auto-play animation the model authors as an F-curve. There is no target
model — the model sculpts and rigs toward a written brief, and may add its own
extra parts, joints, and animations on top. The recorded per-part operations are
regenerated into a rigged 3D model the frontend renders with the looping
animations playing, and a reviewer judges it against the brief: that it reads
as a foundry spire, the rail-arm slides and the focus-ring spins on their own
without detaching, the base stays fixed, and the parts stay attached are what they
weigh.
