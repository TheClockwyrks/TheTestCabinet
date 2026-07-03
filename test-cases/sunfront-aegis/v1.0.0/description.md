**Sunfront Aegis** is a colossal Duneforged **six-legged walking fortress** — a
tiered, prowed armored citadel that dwarfs every buildable unit, bristling with
guns and striding on six heavy legs. This asset-generation case asks a model to
sculpt *and rig* it as an 88×80×104 opaque-voxel model using only the
`voxel-anim` tool, one operation at a time: an immense armored hull (the fixed
root) raised on **six independent, two-jointed legs** — an upper thigh and a
lower shin with a knee, so each foot lifts clear of the ground on its swing — a
big central main turret with a long forward cannon, a rotating secondary turret
**mounted out on each side sponson**, and a decorative radar vane that sweeps on
its own. The rig's required, game-facing contract is sixteen caller-driven
joints — a **`hip_*`** and a **`knee_*`** for each of the six legs (which the
reviewer's **`march`** walk animation strides in an alternating tripod), plus
**`main_turret_yaw`** (fine corrections within a narrow forward cone),
**`main_gun_pitch`** (cannon elevation), and **`left_turret_yaw`** /
**`right_turret_yaw`** (each side turret traversing only its own flank, driven
by the **`bombardment`** weapon animation) — over one auto **`radar_spin`** that
turns the vane forever. There is no target model — the model sculpts and rigs
toward a written brief, and may add its own extra parts and joints on top. The
recorded per-part operations are regenerated into a rigged 3D model the frontend
renders with live joint controls and the two play-back animations, and a
reviewer judges it against the brief: that it reads as a giant six-legged
walking fortress, the legs stride independently without clipping the ground, the
main cannon aims forward and elevates without detaching, the side turrets are
side-mounted and each sweep their own flank, and the hull stays put while only
the moving parts move.
