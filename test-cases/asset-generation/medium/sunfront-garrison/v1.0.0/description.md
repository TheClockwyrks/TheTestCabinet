**Sunfront Garrison** is a low, wide Duneforged fortified infantry barracks — a
muster post from which fresh troopers deploy.

This asset-generation case asks a model to sculpt *and rig* it as a 60×64×60
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time: a broad brass-and-sandstone blockhouse with a crenellated parapet and
amber-glowing firing ports, a fortified muster gate with a hinged deployment ramp,
and a belfry over the gate holding an iron bell. Crucially, the case does **not**
hand the model a rig: it fixes only the two self-playing animations the model must
author, and leaves the parts, joints, and articulation that realize them entirely
to the model. Those two are **`muster_ramp_drop`**, which hinges the front
deployment ramp down from the muster gate toward the ground and lifts it back, and
**`muster_bell_swing`**, which swings the belfry bell side to side about its yoke.
Both animations play on their own, continuously, so the garrison cycles with no
caller while the blockhouse stays put.

As the Trooper's spawner it is deliberately its own building — a humble, fortified
infantry billet, plainly different from the faction's industrial foundries and its
grand Bastion keep. So the test measures whether a model can work out the pieces a
fortified barracks needs, attach them where they belong, and animate them
convincingly. There is no target model: the model sculpts and rigs toward a written
brief, and may add its own extra parts and animations on top.

The recorded per-part operations are regenerated into a rigged 3D model the frontend
renders with the ramp and bell cycling on their decorative auto-play animations, and
a reviewer judges it against the brief: that it reads as a fortified infantry
barracks, the ramp lowers and the bell swings on their own without detaching, the
blockhouse body stays fixed, and only the moving elements move.
