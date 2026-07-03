**Sunfront Lancer Foundry** is a tall, slender Duneforged spire with a sliding
rail-arm and a spinning focus-ring. This asset-generation case asks a model to
sculpt *and rig* it as a 44×84×44 opaque-voxel model using only the `voxel-anim`
tool, one operation at a time: a masonry base tower rising into a narrow shaft, a
heavy iron rail-arm set into the mid-shaft, and a machined focus-ring crowning the
top, with a solar-hot energy core. Crucially, the case does **not** hand the model a
rig: it fixes only the two self-playing animations the model must author — a
**`rail_arm_slide`** that rides the arm up and down its shaft and a
**`focus_ring_spin`** that turns the ring a full revolution — and leaves the parts,
joints, and articulation that realize them entirely to the model, so the test
measures whether a model can work out the pieces a spire with a sliding arm and a
spinning ring needs, attach them where they belong, and animate them convincingly.
There is no target model — the model sculpts and rigs toward a written brief and may
add its own extra parts, joints, and animations on top. The recorded per-part
operations are regenerated into a rigged 3D model the frontend renders with the
looping animations playing, and a reviewer judges it against the brief: that it reads
as a foundry spire, the rail-arm slides and the focus-ring spins on their own without
detaching, the base stays fixed, and the moving pieces stay attached.
