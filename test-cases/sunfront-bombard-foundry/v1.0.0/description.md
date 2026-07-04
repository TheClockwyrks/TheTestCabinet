**Sunfront Bombard Foundry** is a heavy Duneforged mortar-works with a swinging
overhead crane arm and a bobbing loading piston.

This asset-generation case asks a model to sculpt *and rig* it as a 60×68×60
opaque-voxel model using only the `voxel-anim` tool, one operation at a time:
the model paints discrete opaque cells into a blocky brass masonry works, an
iron crane arm cantilevered off its top, and an iron loading piston riding in
its flank.

Crucially, the case does **not** hand the model a rig: it fixes only the two
animations the model must author — a self-playing **`crane_swing`** that rocks
the crane arm fore and aft and a self-playing **`piston_bob`** that bobs the
piston down and back up — and leaves the parts, joints, and articulation that
realize them entirely to the model, so the test measures whether a model can
work out the pieces a swinging, bobbing mortar-works needs, attach them where
they belong, and animate them convincingly (a crane arm that swings with a
weighty pendulum settle, a piston that lands with a stamp). There is no target
model — the model sculpts and rigs toward a written brief.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the crane arm and piston cycling on their own
self-playing animations, and a reviewer judges it against the brief: that it
reads as a mortar-works, the crane swings and piston bobs about a consistent
axis without detaching, the works body stays fixed, and the crane arm and
piston stay attached across their full range of motion.
