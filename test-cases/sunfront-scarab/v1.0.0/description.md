**Sunfront Scarab** is a low, wide four-legged Duneforged war-beetle with snapping
front mandibles.

This asset-generation case asks a model to sculpt *and rig* it as a 48×28×56
opaque-voxel model using only the `voxel-anim` tool, one operation at a time: a
domed brass carapace body (the fixed root), four iron legs at its corners, and a
pair of jaws at the head. Crucially, the case does **not** hand the model a rig: it
fixes only the two animations the model must author — a walking **`walk`** and a
weapon **`bite`** — and leaves the parts, joints, and articulation that realize
them entirely to the model.

So the test measures whether a model can work out the pieces a walking, biting
beetle needs, attach them where they belong, and animate them convincingly: legs
that plant a flat foot and push the body forward in a diagonal-pair gait,
mandibles that snap open and shut about their hinge. There is no target model: the
model sculpts and rigs toward a written brief, authors the `walk` and `bite`
animations as F-curves, and may add its own extra parts and joints on top.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the played-back `walk` and `bite` animations, and a reviewer
judges it against the brief: that it reads as a scuttling war-beetle, the legs
stride independently without clipping the ground, the mandibles snap without
detaching, and the body stays fixed.
