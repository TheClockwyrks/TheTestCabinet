**Sunfront Bombard** is a low, tracked Duneforged siege mortar with a swiveling
turret and a long, high-lobbing barrel. This asset-generation case asks a model
to sculpt *and rig* it as a 56×44×80 opaque-voxel model using only the
`voxel-anim` tool, one operation at a time: a tracked brass hull (the fixed root),
a turret mounted on top, and a long mortar barrel projecting from the turret. The
rig's required, game-facing contract is two caller-driven joints —
**`turret_yaw`**, a rotation about the vertical axis that swings the turret, and
the barrel with it, a full half-turn each way about its mount, and
**`barrel_pitch`**, a rotation about the across axis that elevates and depresses
the mortar barrel to lob high. There is no target model — the model sculpts and
rigs toward a written brief, and may add its own extra parts and joints on top.
The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with live `turret_yaw` and `barrel_pitch` controls and a
`bombard_fire` animation, and a reviewer judges it against the brief: that it
reads as a tracked siege mortar, the turret swivels and the barrel lobs on the
correct pivots without detaching, the chassis stays fixed, and the barrel stays
attached to the turret are what they weigh.
