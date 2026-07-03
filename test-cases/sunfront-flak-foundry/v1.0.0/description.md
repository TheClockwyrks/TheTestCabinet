**Sunfront Flak Foundry** is a tall Duneforged works crowned with a sweeping radar
dish and carrying a bobbing piston. This asset-generation case asks a model to
sculpt *and rig* it as a 56×76×56 opaque-voxel model using only the `voxel-anim`
tool, one operation at a time: a blocky brass masonry works (the fixed root) with
a short central mast, a broad radar dish on that mast, and a charging piston on
its flank. The rig's required contract is two auto-driven joints — a **`dish_sweep`**
rotation that turns the dish a full revolution, and a **`piston_bob`** translation
that pumps the piston down and back up — so the foundry runs on its own while the
`base` stays fixed. There is no target model — the model sculpts and rigs toward
a written brief, and may add its own extra parts and joints on top. The recorded
per-part operations are regenerated into a rigged 3D model the frontend renders
with the dish and piston cycling on their auto-play animations, and a reviewer
judges it against
the brief: that it reads as a works, the dish sweeps and piston bobs on the correct
axes without detaching, the base stays fixed, and the dish and piston stay attached
are what they weigh.
