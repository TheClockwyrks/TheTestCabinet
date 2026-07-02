**Sunfront Aegis** is a colossal Duneforged **six-legged walking fortress** — an
immense armored hull that dwarfs every buildable unit, bristling with guns and
striding on six heavy legs. This asset-generation case asks a model to sculpt *and
rig* it as an 88×80×104 opaque-voxel model using only the `voxel-anim` tool, one
operation at a time: an immense armored hull raised on six iron legs (the fixed
root), a big central main turret with a long forward cannon, and a rotating
secondary gun turret out on each flank. The rig's required, game-facing contract
is four caller-driven joints — **`main_turret_yaw`**, which makes only fine corrections
that keep the main cannon pointed forward within a narrow cone (the fortress turns
its whole hull to aim), **`main_gun_pitch`**, which elevates the cannon, and
**`left_turret_yaw`** / **`right_turret_yaw`**, which traverse the two side turrets
so each swings to cover its own flank independently of the main gun — plus two auto
stride joints, **`legs_left_stride`** / **`legs_right_stride`**, that walk the six
legs in opposite phase on their own. There is no target model — the model sculpts
and rigs toward a written brief, and may add its own extra parts and joints on top.
The recorded per-part operations are regenerated into a rigged 3D model the frontend
renders with live joint controls and a `bombardment` animation, and a reviewer
judges it against the brief: that it reads as a giant six-legged walking fortress,
the main cannon aims forward and elevates without detaching, the side turrets
rotate to aim on their own, the hull stays put while the legs stride, and the guns
and legs stay attached are what they weigh.
