**Aegis — Surface Nets** is a colossal Duneforged *walking fortress* — a
heavily armored citadel that dwarfs every buildable unit, bristling with guns
and striding on legs — rendered as a **smooth, rounded, watertight mesh**. The
fortress is an immense armored hull raised on legs, a big central main turret
with a long forward cannon, a rotating secondary turret out on each flank, and a
decorative radar vane that sweeps on its own.

This asset-generation case asks a model to composite *and rig* it as an
88×80×104 signed-distance-field model using only the `sn-anim` tool, one
operation at a time. Instead of painting cells, the model **adds and subtracts
primitives** (spheres, boxes, ellipsoids, cylinders, with an optional soft
`--blend`) to build each part's field, and **Surface Nets** meshes each field
into a smooth, rounded, uniform-density surface.

Crucially, the case does **not** hand the model a rig: it fixes only the three
animations the model must author — a walking **`march`**, a weapon
**`bombardment`**, and a self-playing **`radar_spin`** — and leaves the parts,
joints, and articulation that realize them entirely to the model. The test
measures whether a model can work out the pieces a walking, firing fortress
needs, attach them where they belong, and animate them convincingly: legs that
plant a flat foot and push the body forward, a cannon that aims and elevates,
and side turrets that each cover their own flank. There is no target model — the
model composites and rigs toward a written brief.

The emitted per-part meshes are assembled into a rigged 3D model the frontend
renders with the play-back animations, and a reviewer judges it against the
brief: that it reads as a giant multi-legged walking fortress with a smooth,
rounded, watertight surface, the legs stride on planted feet without clipping
the ground, the main cannon aims forward and elevates without detaching, the
side turrets are side-mounted and each sweep their own flank, and the hull stays
put while only the moving parts move.
