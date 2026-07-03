**Sunfront Lumen Spire** is a slim Duneforged beacon spire with a spinning halo
ring and a pulsing solar lens. This asset-generation case asks a model to sculpt
*and rig* it as a 44×88×44 opaque-voxel model using only the `voxel-anim` tool,
one operation at a time: a slender brass masonry spire (the fixed root) rising to
a crown, an iron halo ring encircling that crown, and a bright solar lens seated
atop its tip. The rig's required contract is two auto-driven joints — a
**`halo_ring_spin`** rotation that turns the ring a full revolution, and a
**`lens_pulse`** translation that bobs the lens up and back down — so the spire
runs on its own while the `base` stays fixed. There is no target model — the model
sculpts and rigs toward a written brief, and may add its own extra parts and
joints on top. The recorded per-part operations are regenerated into a rigged 3D
model the frontend renders with the ring and lens cycling on their auto-play
animations, and a
reviewer judges it against the brief: that it reads as a beacon spire, the ring
spins and lens pulses on the correct axes without detaching, the base stays fixed,
and the ring and lens stay attached are what they weigh.
