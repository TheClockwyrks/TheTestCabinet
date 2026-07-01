**Ironward Siege Tank** is a heavy tracked tank with a swiveling turret. This
asset-generation case asks a model to sculpt *and rig* it as a 24×16×32
opaque-voxel model using only the `voxel-anim` tool, one operation at a time: a
chassis on tracks (the fixed root), a turret mounted on top, and a barrel
projecting from the turret. The rig's required, game-facing contract is a
caller-driven **`turret_yaw`** joint — a rotation about the vertical axis that
swings the turret, and the barrel with it, a full half-turn each way about its
mount. There is no target model — the model sculpts and rigs toward a written
brief, and may add its own extra parts and joints on top. The recorded per-part
operations are regenerated into a rigged 3D model the frontend renders with a live
`turret_yaw` control, and a reviewer judges it against the brief: that it reads
as a tank, the turret swivels on the correct pivot without detaching, the chassis
stays fixed, and the barrel stays attached are what they weigh.
