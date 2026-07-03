**Sunfront Sentinel** is an upright bipedal Duneforged war-mech carrying a rifle
on its right arm. This asset-generation case asks a model to sculpt *and rig* it
as a 44×64×40 opaque-voxel model using only the `voxel-anim` tool, one operation
at a time: it **paints discrete opaque cells** (single voxels, boxes, lines,
spheres, with a mirror plane) to build each part's body, standing an upright brass
body and head on two iron legs and carrying an iron rifle on the right arm.
Crucially, the case does **not** hand the model a rig: it fixes only the two
animations the model must author — a walking **`walk`** and a rifle-recoil
**`fire`** — and leaves the parts, joints, and articulation that realize them
entirely to the model, so the test measures whether a model can work out the pieces
a walking, firing mech needs, attach them where they belong, and animate them
convincingly (legs that plant a flat foot and push the body forward, a rifle that
aims up and down and recoils without detaching). There is no target model — the
model sculpts and rigs toward a written brief. The recorded per-part operations are
regenerated into a rigged 3D model the frontend renders with the played-back `walk`
and `fire` animations, and a reviewer judges it against the brief: that it reads as
a bipedal war-mech, the legs stride on planted feet without clipping the ground, the
right-arm rifle aims and recoils on a clean hinge without detaching, and the body
stays put while only the moving parts move.
