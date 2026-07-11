# Containment (Standard Mode)

## Overview

This file defines the standard, always-present mode. It builds on the floor in
`specs/playfield.md`, the heat system in `specs/heat.md`, the towers in
`specs/towers.md`, the surge in `specs/creeps.md`, the controls in
`specs/controls.md`, and the flow in `specs/flow.md`.

## Menu Entry

This mode spec adds the following entry to the main menu (see Game states in
`specs/flow.md`), before `HOW TO PLAY`:

- `DEFEND`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a mode, and is always
shown last in the menu.)

## Mode

- **Containment** — the single-floor defense. You hold the one reactor floor of
  `specs/playfield.md` against all `20` waves of the surge, building and
  re-shaping a maze of emitters, pacing their heat to keep your guns in their
  redline plateau — hot but online — by spacing, orienting, and cooling them, and
  answering each wave's mix — slowing the Sprints, concentrating heat on the Hulks,
  splashing the Swarms, flaking the Drifts, and breaking the Core bosses — until
  WAVE 20 is cleared or the reactor breaches.

Containment uses every system exactly as the common specs define it, with no
overrides:

- the tile floor, the two vents and two exhausts, the mazing rules,
  and live re-pathing from `specs/playfield.md`;
- heat as power, the heat-to-damage plateau and per-tower redline, the trip,
  surface cooling through radiator faces, conduction, and the thermostatic
  Forge / coolant Sink from `specs/heat.md`;
- the six emitters and the two movers, their stances, upgrades, and selling
  from `specs/towers.md`;
- the surge types, the flyers, and slow-immunity from `specs/creeps.md`;
- the mouse-and-keyboard controls from `specs/controls.md`;
- the economy, lives, the 20-wave progression with its Core boss milestones,
  scoring, and the win/lose states from `specs/flow.md`.
