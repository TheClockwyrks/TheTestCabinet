**Sunfront Bombard** is a four-legged Duneforged siege mortar walker with a
swiveling turret and a long, high-lobbing barrel. This asset-generation case asks
a model to sculpt *and rig* it as a 56×52×80 opaque-voxel model using only the
`voxel-anim` tool, one operation at a time: a low brass hull (the fixed root)
carried on four independent three-segment iron legs, a turret mounted on top,
and a
long mortar barrel projecting from the turret. The rig's required, game-facing
contract is two caller-driven joints — **`turret_yaw`**, a rotation about the
vertical axis that swings the turret, and the barrel with it, a full half-turn each
way about its mount, and **`barrel_pitch`**, a rotation about the across axis that
elevates and depresses the mortar barrel to lob high — plus twelve auto leg joints
(a hip, a reverse knee, and a flat foot per leg) driven by a **`walk`** gait the
model authors itself as F-curves. There is no target model — the model sculpts and
rigs toward a written brief, and may add its own extra parts, joints, and
animations on top. The recorded per-part operations are regenerated into a rigged
3D model the frontend renders with live `turret_yaw` and `barrel_pitch` controls
and playable **`walk`** and **`bombard_fire`** animations, and a reviewer judges
it
against the brief: that it reads as a four-legged siege-mortar walker, its legs
stride in a diagonal-pair gait with planted flat feet, the turret swivels and the
barrel lobs on the correct pivots without detaching, and the body stays fixed while
the barrel and legs stay attached.
