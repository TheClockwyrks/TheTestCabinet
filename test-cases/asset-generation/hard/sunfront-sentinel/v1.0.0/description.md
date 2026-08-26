**Sunfront Sentinel** is an upright bipedal Duneforged war-mech carrying a
rifle on its right arm.

This asset-generation case asks a model to sculpt and rig it as a 20×40×20
opaque-voxel model using only the `voxel-anim` tool, one operation at a time.
The model paints discrete opaque cells to build each part's body, using single
voxels, boxes, lines, spheres, and a mirror plane. It stands an upright brass
body and head on two iron legs and carries an iron rifle on the right arm.

The case fixes only the two animations the model must author: a walking `walk`
and a rifle-recoil `fire`. The parts, joints, and articulation that realize
them are the model's to invent, so the case measures whether a model can work
out the pieces a walking, firing mech needs, attach them where they belong, and
animate them convincingly. That means legs that plant a flat foot and push the
body forward, and a rifle that aims up and down and recoils without detaching.
There is no target model: the model sculpts and rigs toward a written brief.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the played-back `walk` and `fire` animations. A reviewer
judges it against the brief: that it reads as a bipedal war-mech, the legs
stride on planted feet without clipping the ground, the right-arm rifle aims
and recoils on a clean hinge without detaching, and the body stays put while
only the moving parts move.
