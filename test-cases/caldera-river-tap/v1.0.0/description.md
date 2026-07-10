**Caldera River Tap** is the smallest, lowest waterworks of the Holdfast — a low brass
sluice gate spanning a river channel, a weir with a liftable gate in an iron frame, with
an undershot paddle wheel turning in the flow beside it. It is gravity-fed and simple.

This asset-generation case asks a model to sculpt *and rig* it as a 28×26×28
opaque-voxel model using only the `voxel-anim` tool, one operation at a time: a low weir
across a channel, a liftable gate in an iron frame, and a paddle wheel set low in the
flow. Crucially, the case does **not** hand the model a rig: it fixes only the two
animations the model must author — a gentle self-playing **`idle`** and a steady
**`draw`** — and leaves the parts, joints, and articulation that realize them entirely to
the model.

The River Tap is one of the four Caldera structures. It is the smallest and lowest — a
simple gravity-fed weir with a liftable sluice gate and an undershot paddle wheel,
brass-and-iron machinery rather than a creature. The two animations must read differently
too: the idle turns the wheel gently, and `draw` lifts the gate and spins the wheel up
while staying simple and gravity-fed.

It also carries a machine-readable contract the game depends on. The sluice gate frame is
an **accent region** sculpted in one reserved color and appearing nowhere else on the
model; the Caldera build finds every voxel of that color and repaints it on load. The
fluid structures do not upgrade, so the accent is always painted to brass dark — but the
recolor runs unconditionally, so a scattered or misplaced accent region breaks it.

The recorded per-part operations are regenerated into a rigged 3D model the frontend
renders with the played-back `idle` and `draw` animations, and a reviewer judges it
against the brief: that it reads unmistakably as the River Tap, turns its paddle wheel
gently on its idle, lifts its gate and draws steadily on its draw, and carries a
contiguous, correctly colored verdigris accent.
