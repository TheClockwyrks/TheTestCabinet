**Caldera Pump** is the Holdfast's walking-beam engine: a broad brass frame
carrying a great iron rocking beam pivoted at its center, one end weighted by a
counterweight and the other driving a piston rod into the ground, with a long
intake snorkel reaching out to the deep water beside it and a flywheel turning on
the frame. It is one of the four Caldera structures, brass-and-iron machinery in
the Holdfast palette.

This asset-generation case asks a model to sculpt and rig it as a 40×34×40
opaque-voxel model using only the `voxel-anim` tool, one operation at a time: a
broad frame, a heavy see-sawing beam, a counterweight and piston rod at its ends,
a reaching snorkel, and a flywheel. The case fixes the two animations the model
must author and leaves the parts, joints, and articulation that realize them to
the model. The `idle` animation plays itself and ticks the engine over slowly;
`pump` see-saws the beam hard as unmistakable work.

The Pump also carries a machine-readable contract the game depends on. The
counterweight and the flywheel rim form an accent region sculpted in one reserved
color that appears nowhere else on the model, and the Caldera build finds every
voxel of that color and repaints it on load. The fluid structures do not upgrade,
so the accent is always painted to brass dark. The recolor runs unconditionally,
so a scattered or misplaced accent region breaks it.

The recorded per-part operations are regenerated into a rigged 3D model. The
frontend renders it with the played-back `idle` and `pump` animations. A reviewer
judges it against the brief: that it reads unmistakably as the Pump, ticks over
slowly on its idle, see-saws its beam hard as real work on its pump, and carries
a contiguous, correctly colored verdigris accent.
