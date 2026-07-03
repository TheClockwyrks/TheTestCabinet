**Sunfront Monolith Forge** is a towering Duneforged great forge with a massive
pounding hammer and a turning gear crown. This asset-generation case asks a model
to sculpt *and rig* it as a 68×84×68 opaque-voxel model using only the
`voxel-anim` tool, one operation at a time: a huge, blocky brass masonry forge
(the fixed root) with a throat up its center, a massive iron hammer riding in that
throat, and a toothed gear crown atop it. The rig's required contract is two
auto-driven joints — a **`hammer_stamp`** translation that pounds the hammer down
and back up, and a **`crown_spin`** rotation that turns the gear crown a full turn
— so the forge runs on its own while the `base` stays fixed. There is no target
model — the model sculpts and rigs toward a written brief, and may add its own
extra parts and joints on top. The recorded per-part operations are regenerated
into a rigged 3D model the frontend renders with the hammer and crown cycling on
their auto-play animations, and a reviewer judges it against the brief: that it
reads as a great
forge, the hammer stamps and crown spins on the correct axes without detaching,
the base stays fixed, and the hammer and crown stay attached are what they weigh.
