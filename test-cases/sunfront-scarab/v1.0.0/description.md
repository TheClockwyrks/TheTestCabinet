**Sunfront Scarab** is a low, wide four-legged Duneforged war-beetle with
snapping front mandibles. This asset-generation case asks a model to sculpt *and
rig* it as a 48×28×56 opaque-voxel model using only the `voxel-anim` tool, one
operation at a time: a domed brass carapace body (the fixed root), two banks of
iron legs down its flanks, and a pair of jaws at the head. The rig's required,
game-facing contract is a caller-driven **`mandibles_snap`** joint — a rotation
that swings the front jaws open and shut about their hinge — while the two leg
banks scuttle on
their own through the auto-driven **`legs_left_scuttle`** and
**`legs_right_scuttle`** joints, stepping in opposite phase. There is no target
model — the model sculpts and rigs toward a written brief, and may add its own
extra parts and joints on top. The recorded per-part operations are regenerated
into a rigged 3D model the frontend renders with a live `mandibles_snap` control
and a `bite` animation, and a reviewer judges it against the brief: that it reads
as a scuttling war-beetle, the mandibles snap on the correct hinge without
detaching, the body stays fixed, and the legs and jaws stay attached are what they
weigh.
