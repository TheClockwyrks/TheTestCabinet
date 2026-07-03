**Sunfront Sentinel Foundry** is a tall Duneforged assembly tower with a hammering
stamping press and a turning drive gear. This asset-generation case asks a model to
sculpt *and rig* it as a 56×72×56 opaque-voxel model using only the `voxel-anim`
tool, one recorded operation at a time: instead of a fixed rig, the model paints
discrete opaque cells to build a blocky brass masonry tower with a throat up its
center, an iron stamping press riding in that throat, and a toothed drive gear on its
flank. Crucially, the case does **not** hand the model a rig: it fixes only the two
self-playing animations the model must author — a hammering **`piston_stamp`** and a
turning **`gear_spin`** — and leaves the parts, joints, and articulation that realize
them entirely to the model, so the test measures whether a model can work out the
pieces a hammering, spinning foundry needs, attach them where they belong, and animate
them convincingly (a heavy press that drops down and eases back up in its throat, a
gear that turns a full revolution and loops). There is no target model — the model
sculpts and rigs toward a written brief. The recorded per-part operations are
regenerated into a rigged 3D model the frontend renders with the press and gear cycling
on their self-playing animations, and a reviewer judges it against the brief: that it
reads as a foundry tower, the press stamps and the gear spins on their own without
detaching, the tower stays put while only the moving parts move, and the press and gear
stay attached across their full range of motion.
