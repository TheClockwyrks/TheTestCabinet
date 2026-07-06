**Spectra Burst** is the enemy-drone explosion VFX from *Spectra*, a two-band
formation shooter — the neon flash a swarm drone throws when the player's fire
pops it.

This asset-generation case asks a model to author it as a 128×128 screen-space
`particle-2d` effect using only the particle tool, one operation at a time: a
sharp neon detonation with a bright white-cyan flash core, a thin expanding cyan
ring shockwave, and radial cyan-and-magenta spark streaks that fade to an empty
field over about 0.7 seconds. The model authors a **system** — emitters, forces,
and per-particle curves — not individual particles; the review UI and a game
**simulate it live** from the emitted `system.json`, so it varies slightly from
one play to the next. A reviewer judges the *character* of the effect against the
brief — its three elements, its lifecycle over the duration, and the Spectra neon
two-band palette — rather than any one frozen frame.
