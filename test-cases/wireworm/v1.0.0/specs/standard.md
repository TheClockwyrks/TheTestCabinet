# Descent (Standard Mode)

## Overview

This file defines the standard, always-present mode. It builds on the board in
`specs/playfield.md`, the charge system in `specs/charge.md`, the worm in
`specs/worm.md`, the foes in `specs/foes.md`, the controls in `specs/controls.md`,
and the flow in `specs/flow.md`.

## Menu Entry

This spec adds the following entry to the main menu (see Game states in
`specs/flow.md`), before `HOW TO PLAY`:

- `DESCEND`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a mode, and is always
shown last in the menu.)

## Mode

- **Descent** — the single-board run. You hold the one board of
  `specs/playfield.md` against the data-worm across all `12` levels, cutting the
  worm apart before it reaches your band, pacing the charge of the field to build
  and then release a chain-arc discharge at the right moment, and answering the
  three foes — shooting the glitch before it eats your charged cluster, cutting
  the dropper's reseed short, and detonating the corruptor's critical line before
  the worm dives it — until `LEVEL 12` is cleared or your lives run out.

Descent uses every system exactly as the common specs define it, with no
overrides:

- the tile board, the node field, the player band, and the persistent field from
  `specs/playfield.md`;
- node charge, the worm charging the field, the shot-into-a-node rules, and the
  chain-arc discharge from `specs/charge.md`;
- the worm's winding, diving, splitting, shortening, and field growth from
  `specs/worm.md`;
- the glitch, the packet-dropper, and the corruptor from `specs/foes.md`;
- the keyboard controls from `specs/controls.md`;
- lives, the 12-level progression, scoring, and the win/lose states from
  `specs/flow.md`.
