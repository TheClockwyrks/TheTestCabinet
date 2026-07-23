**Rising Smoke Column** is a calm, ambient plume of soft grey smoke climbing from a
single point source — the kind that drifts up from a chimney, a smouldering ember, or
a snuffed candle: puffs that billow upward, expand and slow as they climb, curl
turbulently with a slight sideways sway, and grow more transparent until they
dissipate near the top.

This asset-generation case asks a model to author it as a volumetric `particle-3d`
effect using only the particle tool, one operation at a time: not by placing
particles, but by authoring an **emitter system** — a steady-rate smoke source near
the floor, shaped by upward buoyancy, drag that slows the climb, and gentle
turbulence that curls and sways the column, with color, opacity, and size curves that
carry each puff from a dense light grey at the source to a faint dark grey that fades
to nothing near the top. It is a **continuous, seamless loop**: a stream that has
already reached a steady state, so its last frame flows back into its first with no
visible seam or pop. The recorded operations emit a `system.json` that the review UI
**simulates live**; because it is a live, stochastic simulation it varies slightly
from play to play, so a reviewer judges the effect's character — its read as a rising
smoke column, its seamless loop, and its soft rise-and-dissipate motion — across
replays and from multiple orbit angles, not a frozen frame.
