**Caldera River Tap** is the smallest, lowest waterworks of the Holdfast: a low
brass sluice gate spanning a river channel, a weir with a liftable gate in an iron
frame, with an undershot paddle wheel turning in the flow beside it. It is
gravity-fed and simple, one of the four Caldera structures, brass-and-iron
machinery in the Holdfast palette.

This asset-generation case asks a model to sculpt and rig it as a 28×26×28
opaque-voxel model using only the `voxel-anim` tool, one operation at a time: a low
weir across a channel, a liftable gate in an iron frame, and a paddle wheel set low
in the flow. The case fixes the two animations the model must author and leaves the
parts, joints, and articulation that realize them to the model. The `idle`
animation plays itself and turns the wheel gently; `draw` lifts the gate and spins
the wheel up while staying simple and gravity-fed.

The River Tap also carries a machine-readable contract the game depends on. The
sluice gate frame is an accent region sculpted in one reserved color that appears
nowhere else on the model, and the Caldera build finds every voxel of that color
and repaints it on load. The fluid structures do not upgrade, so the accent is
always painted to brass dark. The recolor runs unconditionally, so a scattered or
misplaced accent region breaks it.

The recorded per-part operations are regenerated into a rigged 3D model. The
frontend renders it with the played-back `idle` and `draw` animations. A reviewer
judges it against the brief: that it reads unmistakably as the River Tap, turns its
paddle wheel gently on its idle, lifts its gate and draws steadily on its draw, and
carries a contiguous, correctly colored verdigris accent.
