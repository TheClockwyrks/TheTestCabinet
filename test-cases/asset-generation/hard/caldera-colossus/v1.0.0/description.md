**Caldera Colossus** is the massive elite bruiser of the Slag — a ponderous, columnar
obsidian quadruped on four thick column legs, its enormous body carrying an open furnace
crater in its back that exposes a molten acid-green core, that walks with immense weight
and crushes whatever it reaches.

This asset-generation case asks a model to sculpt *and rig* it as a 64×76×60 opaque-voxel
model using only the `voxel-anim` tool, one operation at a time: four thick column legs,
an enormous body with heavy shoulder guards, an open furnace crater set into the back
exposing a molten core, and molten acid-green seams radiating from the crater. Crucially,
the case does **not** hand the model a rig: it fixes only the three animations the model
must author — a ponderous **`move`**, a crushing **`attack`**, and a self-playing
**`aura`** idle — and leaves the parts, joints, and articulation that realize them
entirely to the model.

The Colossus is one of four Slag archetypes. It is the massive, columnar one, and the
only Slag with an exposed molten core — a blazing furnace crater in its back and the
acid-green seams radiating from it.

It also carries a machine-readable contract the game depends on. The shoulder guards and
the raised rim around the back crater are an **accent region** sculpted in one reserved
color and appearing nowhere else on the model; the Caldera build finds every voxel of that
color and repaints it to show the Colossus's tier — obsidian, steel-plated, or violet
elite — so one model serves all three tiers. A scattered or misplaced accent region breaks
the tier system outright.

The recorded per-part operations are regenerated into a rigged 3D model the frontend
renders with the played-back `move`, `attack`, and `aura` animations, and a reviewer judges
it against the brief: that it reads unmistakably as the Colossus, walks ponderous and in
place, crushes with its whole mass, breathes its furnace aura continuously, and carries a
contiguous, correctly colored accent region.
