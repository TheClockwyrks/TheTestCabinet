**Sunfront Reliquary** is a tall, precious Duneforged monument that cradles a
glowing solar core, encircled by a turning orbital ring and crowned by
counter-rotating guardian fins.

This asset-generation case asks a model to sculpt and rig it as a 60×100×60
opaque-voxel model using only the `voxel-anim` tool, one operation at a time.
The model paints discrete opaque cells to build a blocky brass masonry plinth,
the fixed body, rising into a cradle that holds a brilliant solar core aloft, an
iron ring orbiting the core, and iron guardian fins crowning it.

The case fixes only the three self-playing animations the model must author, and
leaves the parts, joints, and articulation that realize them to the model. They
are a `ring_spin` that turns the ring, a `core_pulse` that rises and settles the
core, and a `fins_spin` that counter-rotates the fins the opposite way. The
model is judged on working out how to split the monument into a fixed body and
its moving pieces, attaching them where they belong, and animating them
convincingly. There is no target model: the model sculpts and rigs toward a
written brief, and may add its own extra parts and animations on top.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the ring, core, and fins cycling on their self-playing
animations. A reviewer judges it against the brief: that it reads as a precious
solar reliquary, the ring turns, core pulses, and fins counter-rotate on clean
axes without detaching, and the plinth stays fixed while only the moving pieces
move.
