**Sunfront Bombard Foundry** is a heavy Duneforged mortar-works with a swinging
overhead crane arm and a bobbing loading piston. This asset-generation case
asks a model to sculpt *and rig* it as a 60×68×60 opaque-voxel model using only
the `voxel-anim` tool, one operation at a time: a blocky brass masonry works (the
fixed root), an iron crane arm cantilevered off its top, and an iron loading
piston riding in its flank. The rig's required contract is two auto-driven
joints — a **`crane_swing`** rotation that rocks the crane arm fore and aft, and
a **`piston_bob`** translation that bobs the piston down and back up — so the
foundry runs on its own while the `base` stays fixed. There is no target model —
the model sculpts and rigs toward a written brief, and may add its own extra
parts and joints on top. The recorded per-part operations are regenerated into a
rigged 3D model the frontend renders with the crane arm and piston cycling on
their clips, and a reviewer judges it against the brief: that it reads as a
mortar-works, the crane swings and piston bobs on the correct axes without
detaching, the base stays fixed, and the crane arm and piston stay attached are
what they weigh.
