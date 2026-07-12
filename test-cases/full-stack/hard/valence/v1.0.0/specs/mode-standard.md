# Valence — The containment campaign

This file (`specs/mode.md`) defines the campaign start this run plays and its main-menu
entry. It builds on the board in `specs/board.md`, the matter in `specs/matter.md`, the
towers in `specs/towers.md`, the controls in `specs/controls.md`, and the flow in
`specs/flow.md`.

## Menu entry

This start adds the following entry to the main menu (see Game states in `specs/flow.md`),
before `HOW TO PLAY`:

- `CONTAINMENT`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a start, and is always shown last
in the menu.)

## The start

- **Containment** — the standard campaign. You begin with a **starting energy of `500`** and
  a **starting integrity of `100`**, and play the full **20-round** run (`specs/flow.md`):
  break the matter down before it reaches the collector, banking and spending energy across
  the escalating rounds, until you either clear the final round with integrity to spare
  (victory) or run out of integrity (containment failed). The `500` opening buys a real
  starting board — a few towers across the grid — rather than a single tower, so the opening
  build phase is a genuine layout decision.

This start uses every system exactly as the common specs define it, with no overrides:

- the **board**, its conduit, lanes, and build grid from `specs/board.md`;
- the **matter** — hit points, damage types, and stackable traits — from `specs/matter.md`;
- the **seven towers**, their damage types, detection, branch upgrades, and selling from
  `specs/towers.md`;
- the controls from `specs/controls.md`;
- and the economy, integrity, the 20-round progression with its milestone bosses, scoring,
  the states, and the HUD from `specs/flow.md`, with **interest enabled** as that file
  defines it.
