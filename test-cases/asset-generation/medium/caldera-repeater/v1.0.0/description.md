**Caldera Repeater** is the cheap workhorse tower of the Holdfast: a slim brass
post rising to a rotating drum of many short iron barrels, like a rotary gun, that
ticks over on its own and cycles its muzzles in a rapid burst when it fires. It is
one of four Holdfast towers, and the drum of many short barrels is what tells it
apart at a glance. It is a static emplacement of brass-and-iron machinery, and its
base stays put.

This asset-generation case asks a model to sculpt and rig it as a 24×50×24
opaque-voxel model using only the `voxel-anim` tool, one operation at a time: a
slender brass post founded on the ground, a cluster of short iron barrels arranged
around a spinning axis, and a verdigris accent collar where the drum meets the
post. The case fixes the two animations the model must author: a self-playing
`idle` and a triggered `fire`. The parts, joints, and articulation that realize
them are the model's.

The Repeater also carries a machine-readable contract the game depends on. The
accent collar is sculpted in one reserved color that appears nowhere else on the
model, and the Caldera build finds every voxel of that color and repaints it to
show the tower's upgrade level: brass dark at level 0, steel at level 1, gold at
level 2. One model therefore serves all three levels, and a scattered or misplaced
accent region breaks the upgrade system outright.

The recorded per-part operations are regenerated into a rigged 3D model. The
frontend renders it with the played-back `idle` and `fire` animations. A reviewer
judges it against the brief: that it reads unmistakably as the Repeater, ticks its
drum over on its own, cycles its muzzles in a burst, and carries a contiguous,
correctly colored accent collar while its post and base stay fixed.
