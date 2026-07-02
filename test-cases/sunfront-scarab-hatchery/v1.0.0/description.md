**Sunfront Scarab Hatchery** is a squat, wide Duneforged hive-mound clustered
with amber-glowing hatch cells. This asset-generation case asks a model to sculpt
*and rig* it as a 56×40×56 opaque-voxel model using only the `voxel-anim` tool,
one operation at a time: a low brass hive-mound (the fixed root), a
central iris hatch crowning it, and an exhaust vent set into its side. The rig has
no caller-driven controls — instead both animated elements cycle on their own: the
central hatch slowly turns about its vertical axis on the auto-driven
**`hatch_turn`** joint, and the side vent rises and settles on the auto-driven
**`vent_bob`** joint, each looping continuously. There is no target model — the
model sculpts and rigs toward a written brief, and may add its own extra parts and
joints on top. The recorded per-part operations are regenerated into a rigged 3D
model the frontend renders with the hatch and vent cycling on their clips, and a
reviewer judges it against the brief: that it reads as a hive-mound hatchery, the
hatch turns and vent bobs on their own without detaching, the base stays fixed,
and the sub-parts stay attached are what they weigh.
