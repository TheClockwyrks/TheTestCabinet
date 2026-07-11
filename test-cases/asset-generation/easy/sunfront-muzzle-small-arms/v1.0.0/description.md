**Sunfront Small-Arms Muzzle Flash** is the muzzle flash from *Sunfront*, a
real-time tug-of-war of solar-powered war automatons — the hot flash that spits
from the barrel of a rifle or light autocannon as one of the game's infantry and
light-gunner units fires.

This asset-generation case asks a model to author it as a volumetric `particle-3d`
effect using only the particle tool, one operation at a time: not by placing
particles, but by authoring an **emitter system** — a white-hot flash core at the
muzzle, a short forward spit of hot-orange sparks, and a faint grey smoke wisp,
shaped by forward projection, drag, a light gravity, and the smoke's buoyancy, with
color, opacity, and size curves over each particle's life. It is a **one-shot**
flash — one shot's worth — that fires at the start and decays cleanly to empty; the
game plays a fresh instance once per shot, in sync with the firing unit's cadence, so
the flash rate matches the unit's fire rate. The recorded operations emit a
`system.json` that the review UI and the game **simulate live**; because it is a
live, stochastic simulation it varies slightly from play to play, so a reviewer
judges the effect's character — its read as a muzzle flash, its clean one-shot decay,
and its forward-directed motion — across replays and from multiple orbit angles, not
a frozen frame.
