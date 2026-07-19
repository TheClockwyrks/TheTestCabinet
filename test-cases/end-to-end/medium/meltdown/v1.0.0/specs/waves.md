# Waves

## Overview

This file defines the run: the opening build phase, the build phases between waves,
the progression of waves, the milestone waves, difficulty scaling, and victory and
loss. It refers to the floor in `specs/reactor.md`, the surge in `specs/surge.md`,
the economy in `specs/economy.md`, the controls in `specs/controls.md`, the game
states in `specs/states.md`, and the modes and difficulties in `specs/modes.md`.

The numeric values here are fixed; implement them exactly as written.

## Build phases

- Between waves there is a build phase of up to 15 s (its countdown shown in the build
  panel), during which the surge is not spawning and you build, upgrade, sell, and
  re-shape the maze. Interest is paid at its start (`specs/economy.md`). You may choose
  to send the next wave early (`specs/controls.md`) for the early-send bonus, or let
  the timer expire to start it automatically.
- The opening build phase, before Wave 1, is untimed. It shows no countdown and never
  starts on its own: the player lays their opening maze at leisure and presses Start
  (the same wave control, `specs/controls.md`) to begin Wave 1 when they are ready.
  Because there is no timer, the opening phase pays no early-send bonus, and interest
  (paid only at the start of the between-wave build phases) does not apply to it.
  Because nothing has fought yet, every tower placed in the opening phase is fully
  refundable while it lasts (`specs/towers.md`), so the whole opening layout can be
  re-shaped without penalty. Only the phases between waves carry the 15 s countdown and
  auto-start.

## Waves and victory

- A game is a run of `N` waves on the one floor, where `N` is set by the selected mode
  and difficulty (`specs/modes.md`); the standard Medium run is 20. Waves are numbered
  `WAVE 1` through `WAVE N`.
- During a wave, the surge spawns from the vents over time (the exact timing and vent
  split are specified in `specs/surge.md`). A wave is cleared when every unit it
  released has either died or leaked. Clearing a wave pays its bonus (`specs/economy.md`)
  and begins the next build phase.
- Milestone waves. The final wave (Wave `N`) always includes a Core boss
  (`specs/surge.md`) amid the surge, and one earlier milestone wave near the midpoint
  of the run (`round(N / 2)`) does too. In the standard 20-wave Medium run these are
  Wave 10 and Wave 20.
- Difficulty scaling. Surge HP scales with the wave number `w`: a unit's HP is its base
  HP (`specs/surge.md`) times `1 + 0.20 * (w - 1)` (so a Medium Wave 20 unit has about
  4.8x its base HP, and a longer run climbs higher). Counts grow substantially across
  the run, so waves are large and dense and the player's many-tower maze is always
  pressed (`specs/surge.md`). Speeds, bounties, and leak values do not scale. All other
  systems (heat, coupling, the towers) are unchanged across waves.
- Victory. Surviving the final wave (Wave `N`), clearing it with at least one life
  left, wins the game (the Victory state, `specs/states.md`). A special mode may define
  its own win condition (`specs/modes.md`: The Hundred is won by clearing its whole
  100-unit onslaught).
