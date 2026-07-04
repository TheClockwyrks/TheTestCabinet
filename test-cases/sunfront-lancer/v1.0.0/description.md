**Sunfront Lancer** is a tall bipedal Duneforged marksman-mech carrying a long
center rail-lance.

This asset-generation case asks a model to sculpt *and rig* it as a 24×50×50
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at
a time: it paints discrete opaque cells to build an upright brass-and-sandstone
body (the fixed core), two articulated iron legs that stride beneath it, and a
slender rail-lance projecting forward from the chest, with a clear solar-amber
charge-coil accent.

Crucially, the case does **not** hand the model a rig: it fixes only the two
animations the model must author — a striding **`walk`** and a weapon-only
**`fire`** recoil — and leaves the parts, joints, and articulation that realize
them entirely to the model, so the test measures whether a model can work out
the pieces a walking, aiming marksman-mech needs, attach them where they belong,
and animate them convincingly (legs that plant a flat foot and push the body
forward in opposite phase, a rail-lance that aims and recoils about its chest
mount without detaching). There is no target model — the model sculpts and rigs
toward a written brief, and may add its own extra parts, joints, and animations
on top.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with playable `walk` and `fire` animations, and a reviewer
judges it against the brief: that it reads as a bipedal rail-lance marksman, the
lance aims and recoils on its chest mount without detaching, the legs stride on
planted feet without clipping the ground, the body stays fixed, and the legs
and lance stay attached.
