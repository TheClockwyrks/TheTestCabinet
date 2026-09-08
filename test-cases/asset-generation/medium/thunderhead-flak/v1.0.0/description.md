**Thunderhead Flak Burst** is the anti-air flak burst from _Thunderhead_, a naval
fleet-command game. It is the mid-air puff a proximity shell makes when it
detonates near an aircraft.

This asset-generation case asks a model to author it as a volumetric
`particle-3d` effect using only the particle tool, one operation at a time. The
model does not place particles: it authors an emitter system for a white-hot
detonation core, a radial burst of hot sparks, and a lingering grey-black smoke
puff, shaped by gravity, drag, a radial push, and buoyancy, with color, opacity,
and size curves over each particle's life. The recorded operations emit a
`system.json` that the review UI and the game simulate live. The simulation is
stochastic, so the effect varies slightly from play to play. A reviewer judges the
effect's character across replays and from multiple orbit angles, not a frozen
frame: its read as a flak burst, its lifecycle over ~1.5 seconds, and its motion.
