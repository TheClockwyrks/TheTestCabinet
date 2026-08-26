**Sunfront Aegis** is a colossal Duneforged walking fortress: a heavily armored
citadel that dwarfs every buildable unit, bristling with guns and striding on
legs, rendered from opaque voxels.

This asset-generation case asks a model to sculpt and rig it as a 120×110×150
voxel model using only the `voxel-anim` tool, one operation at a time. The model
paints discrete voxel cells to build each part, using single cells, filled and
stroked boxes, 3D lines and spheres. The fortress is an immense armored hull
raised on legs, a big central main turret with a long forward cannon, a rotating
secondary turret out on each flank, and a decorative radar vane that sweeps on
its own.

The case fixes only the three animations the model must author: a walking
`march`, a weapon `bombardment`, and a self-playing `radar_spin`. The parts,
joints, and articulation that realize them are entirely the model's to invent, so
the case measures whether a model can work out the pieces a walking, firing
fortress needs, attach them where they belong, and animate them convincingly.
Legs plant a flat foot and push the body forward, a cannon aims and elevates, and
side turrets each cover their own flank. There is no target model: the model
sculpts and rigs toward a written brief.

The recorded per-part operations are regenerated into a rigged 3D voxel model the
frontend renders with the play-back animations. A reviewer judges it against the
brief: that it reads as a giant multi-legged walking fortress, the legs stride on
planted feet without clipping the ground, the main cannon aims forward and
elevates without detaching, the side turrets are side-mounted and each sweep
their own flank, and the hull stays put while only the moving parts move.
