**Sunfront Reliquary** is a tall, precious Duneforged monument that cradles a
glowing solar core, encircled by a turning orbital ring and crowned by
counter-rotating guardian fins. This asset-generation case asks a model to sculpt
*and rig* it as a 60×96×60 opaque-voxel model using only the `voxel-anim` tool,
one operation at a time: a blocky brass masonry plinth (the fixed root) rising
into a cradle that holds a brilliant solar core aloft, an iron ring orbiting the
core, and iron guardian fins crowning it. The rig's required contract is three
auto-driven joints — a **`ring_spin`** rotation that turns the ring, a
**`core_pulse`** translation that rises and settles the core, and a **`fins_spin`**
rotation that counter-rotates the fins — so the monument runs on its own while
the `base` stays fixed. There is no target model — the model sculpts and rigs
toward a
written brief, and may add its own extra parts and joints on top. The recorded
per-part operations are regenerated into a rigged 3D model the frontend renders
with the ring, core, and fins cycling on their auto-play animations, and a reviewer
judges it
against the brief: that it reads as a precious solar reliquary, the ring turns,
core pulses, and fins counter-rotate on the correct axes without detaching, the
base stays fixed, and the ring, core, and fins stay attached are what they weigh.
