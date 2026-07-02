**Sunfront Aegis** is a colossal Duneforged **siege fortress on treads** — a great
tracked hull that dwarfs every buildable unit and bristles with guns. This
asset-generation case asks a model to sculpt *and rig* it as an 88×60×104
opaque-voxel model using only the `voxel-anim` tool, one operation at a time: a
low, immense armored hull on two iron treads (the fixed root), a big central main
turret with a long forward cannon, and a rotating secondary gun turret out on each
flank. The rig's required, game-facing contract is four caller-driven joints —
**`main_turret_yaw`**, which makes only fine corrections that keep the main cannon
pointed forward within a narrow cone (the fortress turns its whole hull to aim),
**`main_gun_pitch`**, which elevates the cannon, and **`left_turret_yaw`** /
**`right_turret_yaw`**, which traverse the two side turrets so each swings to cover
its own flank independently of the main gun. There is no target model — the model
sculpts and rigs toward a written brief, and may add its own extra parts and joints
on top. The recorded per-part operations are regenerated into a rigged 3D model
the frontend renders with live joint controls and a `bombardment` animation, and
a reviewer judges it against the brief: that it reads as a giant fortress on
treads, the main cannon aims forward and elevates without detaching, the side
turrets rotate to aim on their own, the tracked hull stays fixed, and the guns
stay attached are what they weigh.
