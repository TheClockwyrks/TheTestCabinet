**Sunfront Scarab** is a low, wide four-legged Duneforged war-beetle with
snapping front mandibles. This asset-generation case asks a model to sculpt *and
rig* it as a 48×28×56 opaque-voxel model using only the `voxel-anim` tool, one
operation at a time: a domed brass carapace body (the fixed root), four independent
two-jointed iron legs at its corners (each a thigh/shin/foot chain), and a pair
of
jaws at the head. The rig's required, game-facing contract is a caller-driven
**`mandibles_snap`** joint — a rotation that swings the front jaws open and shut
about their hinge — plus twelve auto leg joints (`hip_*`, `knee_*`, `foot_*`) the
model-authored **`walk`** drives in a diagonal-pair gait with a planted stance
phase, feet lifting clear and planting flat. There is no target model — the model
sculpts and rigs toward a written brief, authors the `walk` and `bite` animations
as F-curves, and may add its own extra parts and joints on top. The recorded
per-part operations are regenerated into a rigged 3D model the frontend renders
with
a live `mandibles_snap` control and the played-back `walk` and `bite` animations,
and a reviewer judges it against the brief: that it reads as a scuttling war-beetle,
the legs stride independently without clipping the ground, the mandibles snap on
the
correct hinge without detaching, and the body stays fixed are what they weigh.
