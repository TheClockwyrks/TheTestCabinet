**Caldera Scald** is the field tower of the Holdfast: a low, round, bulbous brass
pressure drum ringed by a circle of short radial iron nozzle cowls pointing outward
in every direction, like a steam manifold, with no barrel at all. It holds pressure
on its own and vents a sustained steam field when it emits. It is one of four
Holdfast towers, and being low, round, barrel-less and ringed with nozzles is what
tells it apart at a glance. It is a static emplacement of brass-and-iron machinery
that projects a field, and its base stays put.

This asset-generation case asks a model to sculpt and rig it as a 36×40×36
opaque-voxel model using only the `voxel-anim` tool, one operation at a time: a
bulbous brass drum sitting low to the ground, a ring of short iron nozzle cowls
facing every direction, and a verdigris accent ring of those cowls. The case fixes
the two animations the model must author: a self-playing `idle` and a triggered
`emit`. The parts, joints, and articulation that realize them are the model's.

The Scald also carries a machine-readable contract the game depends on. The accent
ring is sculpted in one reserved color that appears nowhere else on the model, and
the Caldera build finds every voxel of that color and repaints it to show the
tower's upgrade level: brass dark at level 0, steel at level 1, gold at level 2.
One model therefore serves all three levels, and a scattered or misplaced accent
region breaks the upgrade system outright.

The recorded per-part operations are regenerated into a rigged 3D model. The
frontend renders it with the played-back `idle` and `emit` animations. A reviewer
judges it against the brief: that it reads unmistakably as the Scald, holds
pressure on its own, vents a sustained field, and carries a contiguous, correctly
colored accent ring while its base stays fixed.
