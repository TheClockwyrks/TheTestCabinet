**Campfire Flames** is a cozy, seamlessly looping campfire — a small fire already
lit and burning steadily in a warm firelight palette.

This asset-generation case asks a model to author it as a volumetric `particle-3d`
effect using only the particle tool, one operation at a time: not by placing
particles, but by authoring an **emitter system** — licking flame tongues that rise
and flicker (yellow-white at the base, cooling to orange then red at the tips), small
embers that pop upward and drift on the heat, and a thin smoke wisp curling above,
shaped by upward buoyancy and a light turbulence, with color, opacity, and size
curves over each particle's life. It is a **steady-state** effect: the fire is always
burning, so it must **loop seamlessly** with no start, no end, and no burst-and-die.
The recorded operations emit a `system.json` that the review UI **simulates live**;
because it is a live, stochastic simulation it varies slightly from play to play, so a
reviewer judges the effect's character — its read as a campfire, its heat gradient,
its seamless loop, and its organic flicker — across replays and from multiple orbit
angles, not a frozen frame.
