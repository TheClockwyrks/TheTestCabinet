**Caldera Mortar** is the squat lobbing tower of the Holdfast: a heavy, wide
brass base carrying one fat, short, wide-mouthed iron tub angled steeply upward,
that rocks gently on its own and recoils hard as it lobs a shell when it fires.

This asset-generation case asks a model to sculpt and rig it as a 34×34×34
opaque-voxel model using only the `voxel-anim` tool, one operation at a time.
The brief calls for a low, heavy brass base, a stubby upward tub with a broad
flared mouth, and a verdigris accent band ringing that mouth. The case fixes
only the two animations the model must author, a self-playing `idle` and a
triggered `fire`, and leaves the parts, joints, and articulation that realize
them entirely to the model.

The Mortar is one of four Holdfast towers. It is the shortest, squattest one,
with one fat upward tub, and that is what tells it apart at a glance. It is a
static emplacement of brass-and-iron machinery, and its base stays put.

The accent band is an accent region, sculpted in one reserved color and
appearing nowhere else on the model. The Caldera build finds every voxel of that
color and repaints it to show the tower's upgrade level: brass dark at level 0,
steel at level 1, gold at level 2. One model therefore serves all three levels.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the played-back `idle` and `fire` animations. A reviewer
judges it against the brief: that it reads unmistakably as the Mortar, rocks its
tub gently on its own, lobs with a hard recoil, and carries a contiguous,
correctly colored accent band while its base stays fixed.
