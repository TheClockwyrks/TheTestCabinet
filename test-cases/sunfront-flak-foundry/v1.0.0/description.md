**Sunfront Flak Foundry** is a tall Duneforged works crowned with a sweeping radar
dish and carrying a bobbing piston. This asset-generation case asks a model to
sculpt *and rig* it as a 56×76×56 opaque-voxel model using only the `voxel-anim`
tool, one operation at a time: instead of a fixed skeleton, the model paints discrete
opaque cells into a blocky brass masonry works, a broad radar dish on its crown, and
a heavy charging piston on its flank. Crucially, the case does **not** hand the model
a rig: it fixes only the two self-playing animations the model must author — a
**`dish_sweep`** that turns the dish a full revolution and a **`piston_bob`** that
pumps the piston straight down and back up — and leaves the parts, joints, and
articulation that realize them entirely to the model, so the test measures whether a
model can work out the pieces a self-running works needs, attach them where they
belong, and animate them convincingly. There is no target model — the model sculpts
and rigs toward a written brief, and may add its own extra parts and animations on
top. The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the dish and piston cycling on their self-playing animations,
and a reviewer judges it against the brief: that it reads as a works, the dish sweeps
and piston bobs on the correct axes without detaching, the works body stays fixed,
and the dish and piston stay attached throughout.
