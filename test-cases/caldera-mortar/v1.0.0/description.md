**Caldera Mortar** is the squat lobbing tower of the Holdfast — a heavy, wide brass base
carrying one fat, short, wide-mouthed iron tub angled steeply upward, that rocks gently
on its own and recoils hard as it lobs a shell when it fires.

This asset-generation case asks a model to sculpt *and rig* it as a 34×34×34
opaque-voxel model using only the `voxel-anim` tool, one operation at a time: a low,
heavy brass base, a stubby upward tub with a broad flared mouth, and a verdigris accent
band ringing that mouth. Crucially, the case does **not** hand the model a rig: it fixes
only the two animations the model must author — a self-playing **`idle`** and a
triggered **`fire`** — and leaves the parts, joints, and articulation that realize them
entirely to the model.

The Mortar is one of four Holdfast towers: it is the shortest, squattest one with one
fat upward tub, and that is what tells it apart at a glance. It is a static emplacement
— brass-and-iron machinery, not a creature — and its base stays put.

It also carries a machine-readable contract the game depends on. The accent band is an
**accent region** sculpted in one reserved color and appearing nowhere else on the
model; the Caldera build finds every voxel of that color and repaints it to show the
tower's upgrade level — brass dark at level 0, steel at level 1, gold at level 2 — so
one model serves all three levels. A scattered or misplaced accent region breaks the
upgrade system outright.

The recorded per-part operations are regenerated into a rigged 3D model the frontend
renders with the played-back `idle` and `fire` animations, and a reviewer judges it
against the brief: that it reads unmistakably as the Mortar, rocks its tub gently on its
own, lobs with a hard recoil, and carries a contiguous, correctly colored accent band
while its base stays fixed.
