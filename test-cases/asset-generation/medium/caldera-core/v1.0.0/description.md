**Caldera Core** is the Holdfast the whole game defends: a broad stepped brass
keep, a ziggurat of receding tiers rising to a crowned summit, with banners
hanging from its upper tiers and a beacon at the very top. It is the biggest
built thing on the field.

This asset-generation case asks a model to sculpt and rig it as an 80×70×80
opaque-voxel model using only the `voxel-anim` tool, one operation at a time.
The brief calls for a monumental tiered keep, a crown ringing the summit,
banners hung on the upper tiers, and a beacon crowning the top. The case fixes
only the two animations the model must author, a self-playing `idle` and a
one-shot `upgrade`, and leaves the parts, joints, and articulation that realize
them entirely to the model.

The Core is one of the four Caldera structures. It is the largest and most
monumental, a broad tiered brass keep of stepped tiers, hanging banners, and a
crowning beacon, built as architecture rather than machinery.

The crown ring and the banner trim form an accent region, sculpted in one
reserved color and appearing nowhere else on the model. The Caldera build finds
every voxel of that color and repaints it to show the Core's upgrade level:
brass dark, steel, gold, then white-hot. One model therefore serves all four
levels.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the played-back `idle` and one-shot `upgrade` animations.
A reviewer judges it against the brief: that it reads unmistakably as the Core,
keeps itself alive on its own, grinds its tiers up into a taller pose that
holds, and carries a contiguous, correctly colored verdigris accent.
