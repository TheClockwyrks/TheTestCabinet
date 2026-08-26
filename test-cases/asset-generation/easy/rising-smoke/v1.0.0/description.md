**Rising Smoke Column** is a calm, ambient plume of soft grey smoke climbing
from a single point source, the kind that drifts up from a chimney, a
smouldering ember, or a snuffed candle. Puffs billow upward, expand and slow as
they climb, curl turbulently with a slight sideways sway, and grow more
transparent until they dissipate near the top.

This asset-generation case asks a model to author it as a volumetric
`particle-3d` effect using only the particle tool, one operation at a time. The
model authors an emitter system rather than placing particles: a steady-rate
smoke source near the floor, shaped by upward buoyancy, drag that slows the
climb, and gentle turbulence that curls and sways the column. Color, opacity,
and size curves carry each puff from a dense light grey at the source to a faint
dark grey that fades to nothing near the top.

The column is a continuous, seamless loop of a stream that has already reached a
steady state, so its last frame flows back into its first with no visible seam
or pop. The recorded operations emit a `system.json` that the review UI
simulates live, and because the simulation is stochastic the effect varies
slightly from play to play. A reviewer judges its character across replays and
from multiple orbit angles: its read as a rising smoke column, its seamless
loop, and its soft rise-and-dissipate motion.
