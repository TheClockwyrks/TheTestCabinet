**Waterfall Spray** is a seamlessly looping waterfall: a sheet of blue water
droplets pouring down from a ledge, breaking into a billowing white spray where
it lands, with a faint pale mist drifting low over the landing zone.

This asset-generation case asks a model to author it as a volumetric
`particle-3d` effect using only the particle tool, one operation at a time. The
model authors an emitter system: a dense falling sheet of water stretched along
its velocity, a burst of white foam that kicks up and out at the base, and a
slow low mist. Gravity, an outward spray push, drag, and a gentle mist drift
shape them, together with color, opacity, and size curves over each particle's
life. The effect is steady-state, so the water is already falling and never
stops, and it loops seamlessly over its window with no start, no end, and no
visible seam.

The recorded operations emit a `system.json` that the review UI and a game
simulate live. A live, stochastic simulation varies slightly from play to play,
so a reviewer judges the effect's character across replays and from multiple
orbit angles: its read as a waterfall, its seamless loop, and its gravity-driven
fall and billowing spray.
