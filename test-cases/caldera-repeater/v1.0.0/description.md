**Caldera Repeater** is the cheap workhorse tower of the Holdfast — a slim brass post
rising to a rotating drum of many short iron barrels, like a rotary gun, that ticks over
on its own and cycles its muzzles in a rapid burst when it fires.

This asset-generation case asks a model to sculpt *and rig* it as a 24×50×24
opaque-voxel model using only the `voxel-anim` tool, one operation at a time: a slender
brass post founded on the ground, a cluster of short iron barrels arranged around a
spinning axis, and a verdigris accent collar where the drum meets the post. Crucially,
the case does **not** hand the model a rig: it fixes only the two animations the model
must author — a self-playing **`idle`** and a triggered **`fire`** — and leaves the
parts, joints, and articulation that realize them entirely to the model.

The Repeater is one of four Holdfast towers: it is the slim one crowned by a drum of
many short barrels, and that is what tells it apart at a glance. It is a static
emplacement — brass-and-iron machinery, not a creature — and its base stays put.

It also carries a machine-readable contract the game depends on. The accent collar is an
**accent region** sculpted in one reserved color and appearing nowhere else on the
model; the Caldera build finds every voxel of that color and repaints it to show the
tower's upgrade level — brass dark at level 0, steel at level 1, gold at level 2 — so
one model serves all three levels. A scattered or misplaced accent region breaks the
upgrade system outright.

The recorded per-part operations are regenerated into a rigged 3D model the frontend
renders with the played-back `idle` and `fire` animations, and a reviewer judges it
against the brief: that it reads unmistakably as the Repeater, ticks its drum over on
its own, cycles its muzzles in a burst, and carries a contiguous, correctly colored
accent collar while its post and base stay fixed.
