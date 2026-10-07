**Caldera Breaker** is the slow, armored siege of the Slag: a wide, top-heavy
obsidian biped with a brick-slab torso on two short thick legs that walks
knuckled over two enormous fused ram-forearms and grinds through whatever it
reaches.

This asset-generation case asks a model to sculpt and rig it as a 46×44×34
opaque-voxel model using only the `voxel-anim` tool, one operation at a time.
The brief calls for a slab torso far broader than its hips, two short thick
legs, two fused ram-forearms, a ram-head sunk between the shoulders, and
acid-green seams cracking across the chest. The case fixes only the two
animations the model must author, a heavy `move` and a ramming `attack`, and
leaves the parts, joints, and articulation that realize them entirely to the
model.

The Breaker is one of four Slag archetypes. It is the wide, top-heavy, armored
one. It carries no weapon and has no fingers, and its one glow is the acid-green
seams cracking across its chest.

The chest slab plates and the ram-forearms' outer faces are an accent region,
sculpted in one reserved color and appearing nowhere else on the model. The
Caldera build finds every voxel of that color and repaints it to show the
Breaker's tier: obsidian, steel-plated, or violet elite. One model therefore
serves all three tiers.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the played-back `move` and `attack` animations. A reviewer
judges it against the brief: that it reads unmistakably as the Breaker, trudges
heavy and in place, drives its rams home, and carries a contiguous, correctly
colored accent region.
