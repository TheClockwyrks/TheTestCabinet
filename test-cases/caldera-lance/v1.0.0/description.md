**Caldera Lance** is the anti-armor tower of the Holdfast — a tall, narrow brass mast
carrying one long, thin, horizontal iron rail held high, like a rail gun, that traverses
slowly on its own to scan and discharges forward in one hard snap when it fires.

This asset-generation case asks a model to sculpt *and rig* it as a 26×74×30
opaque-voxel model using only the `voxel-anim` tool, one operation at a time: a tall
slender brass mast, a single needle-like iron rail running out far past it, and a
verdigris accent yoke where the rail pivots. Crucially, the case does **not** hand the
model a rig: it fixes only the two animations the model must author — a self-playing
**`idle`** and a triggered **`fire`** — and leaves the parts, joints, and articulation
that realize them entirely to the model.

The Lance is one of four Holdfast towers: it is the tallest, thinnest one holding one
long horizontal rail high, and that is what tells it apart at a glance. It is a static
emplacement — brass-and-iron machinery, not a creature — and its mast stays put.

It also carries a machine-readable contract the game depends on. The accent yoke is an
**accent region** sculpted in one reserved color and appearing nowhere else on the
model; the Caldera build finds every voxel of that color and repaints it to show the
tower's upgrade level — brass dark at level 0, steel at level 1, gold at level 2 — so
one model serves all three levels. A scattered or misplaced accent region breaks the
upgrade system outright.

The recorded per-part operations are regenerated into a rigged 3D model the frontend
renders with the played-back `idle` and `fire` animations, and a reviewer judges it
against the brief: that it reads unmistakably as the Lance, scans its rail on its own,
discharges in one hard snap, and carries a contiguous, correctly colored accent yoke
while its mast stays fixed.
