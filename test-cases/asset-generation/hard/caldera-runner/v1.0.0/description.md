**Caldera Runner** is the fast, fragile chaff of the Slag: a low, long,
ground-hugging obsidian creature that skitters on four sprung legs and throws
its whole body at whatever it reaches.

This asset-generation case asks a model to sculpt and rig it as a 20×24×44
opaque-voxel model using only the `voxel-anim` tool, one operation at a time.
The brief calls for a low wedge of a body, four thin legs, a narrow head
carrying a single acid-green eye slit, and a raised dorsal ridge of plates along
the spine. The case fixes only the two animations the model must author, a
darting `move` and a lunging `attack`, and leaves the parts, joints, and
articulation that realize them entirely to the model.

The Runner is one of four Slag archetypes. It is the low, long, fast one. It
carries no weapon and no armor plating, and its one glow is a single eye slit on
a narrow head.

The dorsal ridge is an accent region, sculpted in one reserved color and
appearing nowhere else on the model. The Caldera build finds every voxel of that
color and repaints it to show the Runner's tier: obsidian, steel-plated, or
violet elite. One model therefore serves all three tiers.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the played-back `move` and `attack` animations. A reviewer
judges it against the brief: that it reads unmistakably as the Runner, runs
light and in place, commits its whole body to the lunge, and carries a
contiguous, correctly colored accent ridge.
