Introduced.

## Tower inspector shows live damage and the heat multiplier

The selected-tower inspector must now display an emitter's current per-shot
damage alongside its **heat damage multiplier** (the live factor its heat is
applying to base damage, e.g. `x3.5`). The multiplier climbs as the tower heats
and then **holds flat from the redline up to the trip** — pushing past the
redline adds trip risk, not more damage — so the damage plateau is readable
directly from the inspector rather than inferred from the emitter's glow (which
saturates across the whole `[redline, 100]` band). The requirement is mandated
in `specs/playfield.md` and cross-referenced in `specs/heat.md`, and the
`heat-is-power.plateau` review item now grades against this readout.
