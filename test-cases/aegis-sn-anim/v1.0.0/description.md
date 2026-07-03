**Aegis (Surface Nets)** is a colossal Duneforged **six-legged walking
fortress** — a heavily armored citadel that dwarfs every buildable unit,
bristling with guns and striding on six heavy legs. This asset-generation case
asks a model to sculpt *and rig* it as a **Surface Nets mesh** using only the
`sn-anim` tool, one operation at a time. Instead of painting cells, the model
shapes a **continuous signed-distance field** by compositing primitives
(spheres, boxes, ellipsoids, cylinders — added, subtracted, and blended), which
Surface Nets extracts into a **smooth, watertight, rounded-armor** surface: an
immense armored hull (the fixed root) raised on **six independent three-segment
legs** — an upper thigh, a lower shin, and a short flat foot on a hip and a
knee, so each foot plants flat and lifts clear of the ground on its swing — a
big central main turret with a long forward cannon, a rotating secondary turret
**mounted out on each side sponson**, and a decorative radar vane that sweeps on
its own. The rig's required contract is eighteen **`auto`** leg joints — a
**`hip_*`**, a **`knee_*`**, and a **`foot_*`** for each of the six legs, driven
by the model-authored **`march`** walk (a two-tripod gait with a planted, flat
stance phase) — plus four caller-driven gun joints: **`main_turret_yaw`** (fine
corrections within a narrow forward cone), **`main_gun_pitch`** (cannon
elevation), and **`left_turret_yaw`** / **`right_turret_yaw`** (each side turret
traversing only its own flank, driven by the **`bombardment`** weapon animation)
— over one auto **`radar_spin`** that turns the vane forever. The model must
**author** all three animations as F-curves. There is no target model — the
model sculpts and rigs toward a written brief, and may add its own extra parts,
joints, and animations on top. Each part's emitted `mesh.json` and the rig are
regenerated into a posable 3D model the frontend renders with live joint
controls and the play-back animations, and a reviewer judges it against the
brief: that it reads as a giant six-legged walking fortress with the smooth,
rounded armor Surface Nets is made for, the legs stride on planted feet without
clipping the ground, the main cannon aims forward and elevates without
detaching, the side turrets are side-mounted and each sweep their own flank, and
the hull stays put while only the moving parts move.
