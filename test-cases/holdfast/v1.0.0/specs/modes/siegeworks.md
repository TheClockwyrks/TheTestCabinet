# Holdfast — Siegeworks

This file defines the **Siegeworks** start, which sits alongside the standard frontier
start. It builds on the standard start in `specs/modes/homestead.md` and changes only the
**threat**: the raids come harder. Everything else is unchanged.

## Menu entry

This mode spec adds the following entry to the main menu (see Game states in
`specs/flow.md`):

- `SIEGEWORKS`

Place it after `NEW COLONY` and before `HOW TO PLAY`.

## The start

- **Siegeworks** — the same colony and the same systems as the standard start, but under
  a **heavier siege**. Two things change about the threat director (`specs/combat.md`):
  - **Bigger raids.** Each raid arrives **markedly larger and stronger** than the
    standard start's, on the same tightening timer — so a defense that would hold the
    standard raids is overrun, and the colony must build deeper defenses (more walls,
    more turrets, more armed shooters) and actually win the fights.
  - **Sappers that break walls.** Raids include **sappers** — raiders that **attack and
    destroy the colony's walls** (`specs/economy.md`, `specs/combat.md`) to punch through
    to the settlers, rather than only shooting from the open. So a single static wall
    ring is **not** a safe answer: the colony must layer defenses, cover the approaches
    with fire, and repel the raid, not merely hide behind one wall.

Everything else is exactly as the standard start (`specs/modes/homestead.md`): the tile
world and resource nodes, the settlers and their needs and mood, the gather/build/cook/
farm economy, the day/night cycle, the controls, and the survival pressure, scoring,
loss state, states, and HUD. Only the **raids** change — but that change must be **real
and felt**: a Siegeworks that plays identically to the standard start (same raid size, no
wall-breaking) has not implemented it.
