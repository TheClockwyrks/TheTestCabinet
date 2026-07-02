**Sunfront Bastion** is a huge Duneforged home keep with a rotating solar
collector crown, a raising gate, and a slowly turning beacon. This
asset-generation case asks a model to sculpt *and rig* it as a 72×88×72
opaque-voxel model using only the `voxel-anim` tool, one operation at a time: a
massive brass masonry fortress (the fixed root) with thick ramparts, corner
towers, and a central spire, an iron collector crown ringing its summit, a gate
in its front wall, and a beacon atop its spire. The rig's required contract is
three auto-driven joints — a **`crown_spin`** rotation that turns the crown, a
**`gate_raise`** translation that lifts the gate up and back down, and a
**`beacon_spin`** rotation that slowly turns the beacon — so the bastion runs on
its own while the `base` stays fixed. There is no target model — the model sculpts
and rigs toward a written brief, and may add its own extra parts and joints on
top. The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the crown, gate, and beacon cycling on their clips, and a
reviewer judges it against the brief: that it reads as a fortified keep, the crown
rotates, gate raises, and beacon spins on the correct axes without detaching, the
base stays fixed, and the three moving parts stay attached are what they weigh.
