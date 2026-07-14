**Sunfront Lancer** is a tall bipedal Duneforged marksman-mech with a heavy
rail-lance cannon mounted on one shoulder.

This asset-generation case asks a model to sculpt *and rig* it as a 32×50×50
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at
a time: it paints discrete opaque cells to build an upright brass-and-sandstone
body (the fixed core), two articulated iron legs that stride beneath it, and a long
rail-lance cannon seated on a structural turret mount bolted to one shoulder — its
barrel projecting forward past the hull — with a clear solar-amber charge-coil
accent. The weapon reads as **machinery built onto the chassis**: a mechanical
addition to the frame, with no hand and no gripping arm. It is not a rifle the mech
holds like a soldier, and not a barrel sunk into the chest.

Crucially, the case does **not** hand the model a rig: it fixes only the two
animations the model must author — a striding **`walk`** and a weapon-only
**`fire`** recoil — and leaves the parts, joints, and articulation that realize
them entirely to the model, so the test measures whether a model can work out
the pieces a walking, aiming marksman-mech needs, attach them where they belong,
and animate them convincingly (legs that plant a flat foot and push the body
forward in opposite phase, and a shoulder cannon that elevates on its trunnion and
kicks straight back along its own axis in its mount without detaching or clipping the
hull). There is no target model — the model sculpts and rigs toward a written brief,
and may add its own extra parts, joints, and animations on top.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with playable `walk` and `fire` animations, and a reviewer
judges it against the brief: that it reads as a bipedal mech with a shoulder-mounted
rail-cannon, the cannon elevates and recoils in its mount without detaching or
clipping the body, the legs stride on planted feet without clipping the ground, the
body stays fixed, and the legs and cannon stay attached.
