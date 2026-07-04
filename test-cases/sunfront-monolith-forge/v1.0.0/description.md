**Sunfront Monolith Forge** is a towering Duneforged great forge with a massive
pounding hammer and a turning gear crown.

This asset-generation case asks a model to sculpt *and rig* it as a 68×84×68
opaque-voxel model using only the `voxel-anim` tool, one operation at a time: a
huge, blocky brass masonry forge tower with a throat up its center, a massive iron
hammer riding in that throat, and a toothed gear crown atop it. Crucially, the
case does **not** hand the model a rig: it fixes only the two animations the model
must author, and leaves the parts, joints, and articulation that realize them
entirely to the model. Those two are a **`hammer_stamp`** that pounds the hammer
deep down and back up and a **`crown_spin`** that turns the gear crown a full
revolution. Both are self-playing idles, so the forge cycles on its own while the
tower stays fixed.

So the test measures whether a model can work out the pieces a pounding, spinning
forge needs, attach them where they belong, and animate them convincingly. There
is no target model: the model sculpts and rigs toward a written brief.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the hammer and crown cycling on their self-playing
animations, and a reviewer judges it against the brief: that it reads as a great
forge, the hammer stamps and crown spins on the correct axes without detaching,
the tower stays fixed, and the hammer and crown stay attached.
