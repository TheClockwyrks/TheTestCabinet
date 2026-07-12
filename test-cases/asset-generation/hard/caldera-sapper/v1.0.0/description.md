**Caldera Sapper** is the network-cutting technician of the Slag — a tall, spindly,
insectile obsidian creature that stalks on four thin high-kneed legs, holds its narrow
body high on a long segmented spine, and cuts pipes and structures with two long shear
arms.

This asset-generation case asks a model to sculpt *and rig* it as a 24×48×28 opaque-voxel
model using only the `voxel-anim` tool, one operation at a time: four thin high-kneed
legs, a narrow body held high on a long segmented spine curving up to a small head, two
long multi-jointed cutting shear arms at the front, and a row of acid-green beads along
the spine. Crucially, the case does **not** hand the model a rig: it fixes only the two
animations the model must author — a spidery **`move`** and a cutting **`attack`** — and
leaves the parts, joints, and articulation that realize them entirely to the model.

The Sapper is one of four Slag archetypes. It is the tall, thin, insectile one, and the
only Slag that carries tools. Its one glow is a row of acid-green beads running along its
spine.

It also carries a machine-readable contract the game depends on. The plates along the
outer faces of both shear arms are an **accent region** sculpted in one reserved color and
appearing nowhere else on the model; the Caldera build finds every voxel of that color and
repaints it to show the Sapper's tier — obsidian, steel-plated, or violet elite — so one
model serves all three tiers. A scattered or misplaced accent region breaks the tier
system outright.

The recorded per-part operations are regenerated into a rigged 3D model the frontend
renders with the played-back `move` and `attack` animations, and a reviewer judges it
against the brief: that it reads unmistakably as the Sapper, stalks quick and in place,
scissors its shears shut on a cut, and carries a contiguous, correctly colored accent
region.
