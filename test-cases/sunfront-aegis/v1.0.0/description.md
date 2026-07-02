**Sunfront Aegis** is a giant Duneforged **siege fortress on treads** — a great
tracked hull bristling with guns. This asset-generation case asks a model to
sculpt *and rig* it as a 72×52×88 opaque-voxel model using only the `voxel-anim`
tool, one operation at a time: a low, broad armored hull on two iron treads (the
fixed root), a big central main turret with a long cannon, and a secondary gun
battery out on each flank. The rig's required, game-facing contract is two
caller-driven joints — **`main_turret_yaw`**, which traverses the whole main
turret (and its cannon with it), and **`main_gun_pitch`**, which elevates the
cannon — while the two side batteries sweep on their own through the auto-driven
**`left_battery_pitch`** and **`right_battery_pitch`** joints, roving in opposite
phase. There is no target model — the model sculpts and rigs toward a written
brief, and may add its own extra parts and joints on top. The recorded per-part
operations are regenerated into a rigged 3D model the frontend renders with live
`main_turret_yaw` and `main_gun_pitch` controls and a `bombardment` animation, and
a reviewer judges it against the brief: that it reads as a fortress on treads, the
main turret traverses and the cannon elevates without detaching, the side batteries
sweep on their own, the tracked hull stays fixed, and the guns stay attached are
what they weigh.
