**Sunfront Trooper** is an armored Duneforged infantry soldier whose whole plated
body deforms as one continuous skin. This asset-generation case asks a model to
sculpt *and rig* it as a 24×48×20 hard-surface character using only the `dc-skin`
tool, one operation at a time: instead of posing rigid segments about pivots, the
model sculpts **one whole-body signed-distance field**, binds it to a skeleton it
invents, and deforms the single continuous skin **across** its joints — an elbow or
knee that bends without a seam. Dual Contouring keeps the sharp edges of the
hard-surface plate.

Crucially, the case does **not** hand the model a rig. It fixes only the three
animations the model must author — a looping **`march`**, a one-shot **`fire`**, and a
one-shot **`brace`** — and leaves the bones, joints, and the per-vertex weights that
bind the skin (derived automatically by bone-heat diffusion) entirely to the model. So
the test measures whether a model can work out the skeleton an armored, marching,
firing soldier needs and make its one continuous skin fold convincingly across the
joints: a stride whose hips and knees flex without tearing, a shoulder-rifle shot whose
recoil ripples through the torso, and a crouch that folds the body behind cover.

The trooper must read unmistakably as the Sunfront Trooper — an upright plated humanoid
with a helmeted amber-visored head, a shouldered rifle, and sand-bleached canvas
breaking up the bronze plate — in the disciplined Duneforged palette. There is no
target model; the model sculpts and rigs toward a written brief. The recorded
operations are regenerated into a skinned 3D character the frontend poses by
linear-blend skinning, and a reviewer judges it against the brief: that it reads as an
armored trooper, deforms as one continuous skin across its joints, and plays back its
three required animations.
