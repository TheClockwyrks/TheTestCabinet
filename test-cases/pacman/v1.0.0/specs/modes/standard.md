# Fathom — Trench (standard mode)

This file defines the standard, always-present mode. It builds on the maze in
`specs/playfield.md`, the sensing in `specs/sensing.md`, the movement and ink in
`specs/movement.md`, the predators in `specs/predators.md`, and the match flow in
`specs/flow.md`.

## Menu entry

This mode spec adds the following entry to the main menu (see Game states in
`specs/flow.md`), before `HOW TO PLAY`:

- `DIVE`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a mode, and is always
shown last in the menu.)

## Mode

- **Trench** — the single-player dive. The human controls the forager (the only
  playable character). You graze the plankton of one dark trench while the three
  predators hunt you, descending to deeper, faster trenches as you clear each one,
  until your last life is lost.

Trench uses every system exactly as the common specs define it, with no overrides:

- the fog of war, the **line-of-sight passive light**, the **omnidirectional sonar
  pulse**, and the brightness rule from `specs/sensing.md`;
- the **cooldown-based, unlimited ink** from `specs/movement.md`;
- the full set of three predators — the Lure, the Listener, and the Flarefish —
  from `specs/predators.md`;
- the scoring, lives, depth scaling, and states from `specs/flow.md`.

The mode label shown in the HUD (see `specs/playfield.md`) during play is
`TRENCH`.
