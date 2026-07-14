**Caldera Scald** is the field tower of the Holdfast — a low, round, bulbous brass
pressure drum ringed by a circle of short radial iron nozzle cowls pointing outward in
every direction, like a steam manifold, with no barrel at all, that holds pressure on
its own and vents a sustained steam field when it emits.

This asset-generation case asks a model to sculpt *and rig* it as a 36×40×36
opaque-voxel model using only the `voxel-anim` tool, one operation at a time: a bulbous
brass drum sitting low to the ground, a ring of short iron nozzle cowls facing every
direction, and a verdigris accent ring of those cowls. Crucially, the case does **not**
hand the model a rig: it fixes only the two animations the model must author — a
self-playing **`idle`** and a triggered **`emit`** — and leaves the parts, joints, and
articulation that realize them entirely to the model.

The Scald is one of four Holdfast towers: it is the low, round, barrel-less one ringed
with nozzles — it projects a field, it does not shoot — and that is what tells it apart
at a glance. It is a static emplacement — brass-and-iron machinery, not a creature — and
its base stays put.

It also carries a machine-readable contract the game depends on. The accent ring is an
**accent region** sculpted in one reserved color and appearing nowhere else on the
model; the Caldera build finds every voxel of that color and repaints it to show the
tower's upgrade level — brass dark at level 0, steel at level 1, gold at level 2 — so
one model serves all three levels. A scattered or misplaced accent region breaks the
upgrade system outright.

The recorded per-part operations are regenerated into a rigged 3D model the frontend
renders with the played-back `idle` and `emit` animations, and a reviewer judges it
against the brief: that it reads unmistakably as the Scald, holds pressure on its own,
vents a sustained field, and carries a contiguous, correctly colored accent ring while
its base stays fixed.
