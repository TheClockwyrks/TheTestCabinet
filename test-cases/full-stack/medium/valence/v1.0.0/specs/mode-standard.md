# Valence — The containment campaign

This file (`specs/mode.md`) defines the campaign start this run plays and its
main-menu entry. It builds on the board in `specs/board.md`, the matter in
`specs/matter.md`, the towers in `specs/towers.md`, the controls in
`specs/controls.md`, and the campaign in `specs/campaign.md`.

## Menu entry

This start adds the following entry to the main menu (see Game states in
`specs/campaign.md`), before `HOW TO PLAY`:

- `CONTAINMENT`

(`HOW TO PLAY` is a state defined in `specs/campaign.md`, not a start, and is
always shown last in the menu.)

## The start

- Containment, the standard campaign. Choosing it opens the map select
  (`specs/board.md`, `specs/campaign.md`), where you pick which map to defend:
  the Easy single-path map, the Medium branching map, or the Hard
  multiple-separate-paths map. You then begin with a starting energy of `650`
  and a starting integrity of `100`, and play the full 40-round run
  (`specs/campaign.md`) on that map: break the matter down before it reaches the
  collector, banking and spending energy across the escalating rounds, until you
  either clear the final round with integrity to spare (victory) or run out of
  integrity (containment failed). The `650` opening buys a real starting board,
  several towers placed across the board rather than a single tower, so the
  opening build phase is a genuine layout decision. The economy, integrity,
  matter, and towers are identical on every map; the map changes only the
  topology you must cover (`specs/board.md`).

This start uses every system exactly as the common specs define it, with no
overrides:

- the board, its maps, paths, and free tower placement from `specs/board.md`;
- the matter (hit points, damage types, and stackable traits) from
  `specs/matter.md`;
- the seven towers, their damage types, detection, branch upgrades, and selling
  from `specs/towers.md`;
- the controls from `specs/controls.md`;
- and the economy, integrity, the 40-round progression with its milestone
  boss, scoring, the states, and the HUD from `specs/campaign.md`, with
  interest enabled as that file defines it.
