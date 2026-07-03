**Sunfront Bombard** is a four-legged Duneforged siege mortar walker with a
swiveling turret and a long, high-lobbing barrel. This asset-generation case asks a
model to sculpt *and rig* it as a 56×52×80 opaque-voxel model using only the
`voxel-anim` tool, one operation at a time: painting discrete opaque cells to build a
low brass hull raised on legs, four legs that carry it, a turret on top, and a long
mortar barrel projecting forward. Crucially, the case does **not** hand the model a
rig: it fixes only the two animations the model must author — a walking **`walk`**
gait and a weapon-showcase **`bombard_fire`** — and leaves the parts, joints, and
articulation that realize them entirely to the model, so the test measures whether a
model can work out the pieces a walking, firing artillery walker needs, attach them
where they belong, and animate them convincingly (legs that plant a flat foot and
push the body forward, a turret that swivels to aim, and a mortar barrel that lobs
and fires). There is no target model — the model sculpts and rigs toward a written
brief, and may add its own extra parts, joints, and animations on top. The recorded
per-part operations are regenerated into a rigged 3D model the frontend renders with
the playable **`walk`** and **`bombard_fire`** animations, and a reviewer judges it
against the brief: that it reads as a four-legged siege-mortar walker, its legs
stride on planted flat feet without clipping the ground, the turret swivels and the
barrel lobs and fires without detaching, and the hull stays put while only the moving
parts move.
