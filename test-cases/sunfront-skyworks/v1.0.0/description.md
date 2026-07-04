**Sunfront Skyworks** is a broad Duneforged launch-pad hangar with a fast spinning
turbine and a raising launch door.

This asset-generation case asks a model to sculpt *and rig* it as a 64×64×64
opaque-voxel model using only the `voxel-anim` tool, one operation at a time: it
paints discrete opaque cells (`set-voxel`, `fill-box`, strokes, lines, spheres,
mirror) into an open brass masonry pad with a center mast, an iron turbine
spinning high on that mast, and a launch door set in its front face. Crucially,
the case does **not** hand the model a rig: it fixes only the two animations the
model must author, and leaves the parts, joints, and articulation that realize
them entirely to the model. Those two are a self-playing **`turbine_spin`** that
turns the turbine a full revolution overhead, and a self-playing
**`launch_door_raise`** that slides the door up, holds it open, and lowers it
back. Both animations play on their own (`auto_play`), so the Skyworks runs
without any caller while the pad itself stays fixed.

So the test measures whether a model can work out the pieces a launch pad with a
spinning turbine and a raising door needs, attach them where they belong, and
animate them convincingly. There is no target model: the model sculpts and rigs
toward a written brief.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the turbine and door cycling on their auto-play animations,
and a reviewer judges it against the brief: that it reads as a launch-pad hangar,
the turbine spins and door raises without detaching, the pad stays fixed while
only the moving parts move, and the turbine and door stay attached across their
range.
