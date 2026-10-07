**Caldera Boiler** is the Holdfast's steam plant: a tall riveted brass pressure
vessel on short legs straddling a geothermal vent, capped by a tall iron chimney
stack, with a bank of pistons down one flank. It takes water in and boils it
into steam.

This asset-generation case asks a model to sculpt and rig it as a 34×44×34
opaque-voxel model using only the `voxel-anim` tool, one operation at a time.
The brief calls for an upright riveted vessel, short legs that straddle the
vent, an iron chimney capping it, and a row of pistons on one side. The case
fixes only the two animations the model must author, a barely-moving
self-playing `idle` and a hard-working `boil`, and leaves the parts, joints, and
articulation that realize them entirely to the model.

The Boiler is one of the four Caldera structures. It is the vent-straddling
steam plant, a riveted vessel and a tall chimney standing over a geothermal
vent, built as brass-and-iron machinery. The two animations must read
differently: the idle barely stirs while banked, and `boil` pumps the pistons
hard as unmistakable active production.

The riveted bands ringing the vessel form an accent region, sculpted in one
reserved color and appearing nowhere else on the model. The Caldera build finds
every voxel of that color and repaints it on load. The fluid structures do not
upgrade, so the accent is always painted to brass dark, and the recolor runs
unconditionally, so a scattered or misplaced accent region breaks it.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the played-back `idle` and `boil` animations. A reviewer
judges it against the brief: that it reads unmistakably as the Boiler, sits
banked and barely moving on its idle, works hard as active production on its
boil, and carries a contiguous, correctly colored verdigris accent.
