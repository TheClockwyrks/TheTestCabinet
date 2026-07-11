# Crossing (Standard Mode)

## Overview

This file defines the standard, always-present mode. It builds on the strait in
`specs/playfield.md`, the hunter in `specs/hunter.md`, the hazards in
`specs/hazards.md`, the water in `specs/water.md`, the controls in
`specs/controls.md`, and the flow in `specs/flow.md`.

## Menu Entry

This mode spec adds the following entry to the main menu (see Game states in
`specs/flow.md`), before `HOW TO PLAY`:

- `CROSS`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a mode, and is always
shown last in the menu.)

## Mode

- **Crossing** — the single-strait run. You take the critter across the one strait
  of `specs/playfield.md` across all `8` levels, filling the five far-shore bays
  each level — dodging the sliding ice hazards, riding the drifting floes without
  falling in or drifting off the edge, beating the crossing timer, and above all
  keeping ahead of the hunting bear (spending the hazards and the water's tempo
  against it) — until `LEVEL 8` is cleared or your lives run out.

Crossing uses every system exactly as the common specs define it, with no
overrides:

- the tile strait, the near shore, the ice band, the median shelf, the water band,
  and the far shore with its bays from `specs/playfield.md`;
- the bear's pursuit, hazard-navigation, and swimming from `specs/hunter.md`;
- the sliding hazards from `specs/hazards.md` and the drifting floes and drift/
  off-edge death from `specs/water.md`;
- the one-tile-hop controls from `specs/controls.md`;
- lives, the timer, the 8-level progression with its per-level speed-up and second
  bear, scoring, and the win/lose states from `specs/flow.md`.
