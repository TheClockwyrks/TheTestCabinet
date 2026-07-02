**Sunfront Bulwark Foundry** is a heavy armored Duneforged bunker-forge with a
raising blast door and a turning drive flywheel. This asset-generation case asks
a model to sculpt *and rig* it as a 60×72×60 opaque-voxel model using only the
`voxel-anim` tool, one operation at a time: a squat, thick-walled armored base
(the fixed root), a broad blast door set into its front, and a great flywheel on
its flank. This foundry has no caller controls — both moving parts animate on
their own: the auto-driven **`blast_door_raise`** joint lifts and drops the door
along its vertical track, and the auto-driven **`flywheel_spin`** joint turns the
wheel about its axle. There is no target model — the model sculpts and rigs
toward a written brief, and may add its own extra parts and joints on top. The
recorded per-part operations are regenerated into a rigged 3D model the frontend
renders with the blast door and flywheel cycling on their own clips, and a
reviewer judges it against the brief: that it reads as an armored bunker-forge,
the door and flywheel cycle on their own, the base stays fixed, and the parts
stay attached are what they weigh.
