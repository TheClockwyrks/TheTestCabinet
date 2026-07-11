**Sunfront Lumen Spire** is a slim Duneforged beacon spire with a spinning halo
ring and a pulsing solar lens.

This asset-generation case asks a model to sculpt *and rig* it as a 46×90×46
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time: a slender brass masonry tower rising to a crown, an iron halo ring
encircling that crown, and a bright solar lens seated atop its tip, all painted
cell by cell. Crucially, the case does **not** hand the model a rig: it fixes
only the two self-playing animations the model must author, and leaves the parts,
joints, and articulation that realize them entirely to the model. The two
animations are a **`halo_ring_spin`** that turns the halo ring a full revolution
about the spire's vertical axis, and a **`lens_pulse`** that bobs the solar lens
up off its seat and back down.

So the test measures whether a model can work out the pieces a spinning, pulsing
beacon needs, attach them where they belong, and animate them convincingly — a
steady spin that wraps seamlessly, an eased bob that hangs and settles with
weight — while the tower stays fixed. There is no target model: the model sculpts
and rigs toward a written brief, and may add its own extra parts and joints on
top.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the ring and lens cycling on their self-playing animations,
and a reviewer judges it against the brief: that it reads as a beacon spire, the
ring spins and lens pulses on the correct axes without detaching, the tower stays
fixed, and the ring and lens stay attached.
