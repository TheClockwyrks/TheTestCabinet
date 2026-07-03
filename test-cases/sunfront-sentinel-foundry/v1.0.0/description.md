**Sunfront Sentinel Foundry** is a tall Duneforged assembly tower with a hammering
stamping press and a turning drive gear. This asset-generation case asks a model
to sculpt *and rig* it as a 56×72×56 opaque-voxel model using only the
`voxel-anim` tool, one operation at a time: a blocky brass masonry tower (the
fixed root) with a throat up its center, an iron stamping press riding in that
throat, and a toothed drive gear on its flank. The rig's required contract is two
auto-driven joints — a **`piston_stamp`** translation that hammers the press down
and back up, and a **`gear_spin`** rotation that turns the gear a full turn — so
the foundry runs on its own while the `base` stays fixed. There is no target
model — the model sculpts and rigs toward a written brief, and may add its own
extra parts and joints on top. The recorded per-part operations are regenerated
into a rigged 3D model the frontend renders with the press and gear cycling on
their auto-playing animations, and a reviewer judges it against the brief: that
it reads as a foundry
tower, the press stamps and gear spins on the correct axes without detaching, the
base stays fixed, and the press and gear stay attached are what they weigh.
