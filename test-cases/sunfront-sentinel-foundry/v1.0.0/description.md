**Sunfront Sentinel Foundry** is a wide Duneforged casting works — an open-fronted
hall where a gantry-slung crucible tips and pours glowing molten metal while great
bellows breathe beside it. It melts and pours metal; it does not hammer or stamp.

This asset-generation case asks a model to sculpt *and rig* it as a 72×56×72
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time. Instead of a fixed rig, the model paints discrete opaque cells to build a wide,
low, open-fronted brass masonry casting hall, a gantry carrying an iron crucible
brimming with molten metal over a casting bed, and great bellows on its flank.
Crucially, the case does **not** hand the model a rig: it fixes only the two
self-playing animations the model must author — a **`crucible_pour`** and a
**`bellows_breathe`** — and leaves the parts, joints, and articulation that realize
them entirely to the model.

Its casting identity deliberately sets it apart from the roster's stamping and
spinning structures — a tipping, pouring crucible and breathing bellows rather than
another vertical stamp and toothed gear. So the test measures whether a model can work
out the pieces a pouring, breathing foundry needs, attach them where they belong, and
animate them convincingly: a full crucible that tips and pours into the bed and eases
back level, and bellows that squeeze shut and draw open in a loop. There is no target
model: the model sculpts and rigs toward a written brief.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the crucible and bellows cycling on their self-playing
animations, and a reviewer judges it against the brief: that it reads as a casting
foundry, the crucible pours and the bellows breathe on their own without detaching,
the hall stays put while only the moving parts move, and the crucible and bellows
stay attached across their full range of motion.
