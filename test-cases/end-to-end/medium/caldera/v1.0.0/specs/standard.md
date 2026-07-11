# Caldera — Mode: The Hold

**The Hold** is the game's mode — the defense that **PLAY** begins from the title
screen (`specs/flow.md`). It is the standard run exactly as the common specs
describe: one procedurally generated caldera, a fluid network you build across it,
and the fixed series of escalating **waves** (`specs/waves.md`) assaulting the Core
from the two breaches — won by clearing the final wave with the Core standing, lost
if the Core falls.

The Hold adds no rules of its own beyond the common specification. It exists as the
named baseline so future versions can add sibling modes (a longer siege, a
one-breach skirmish, an endless survival run, a no-Core-upgrade economy) without
disturbing it.

- **PLAY** starts The Hold; the only in-flow choice is the **starting wave** (on the
  starting-wave prompt, `specs/flow.md`) — begin at wave 1 or skip ahead.
- All parameters are the common ones: the world (`specs/world.md`), the economy and
  building (`specs/build.md`), the fluid network (`specs/fluids.md`), the towers
  (`specs/towers.md`), the Slag (`specs/enemies.md`), and the wave loop
  (`specs/waves.md`).
