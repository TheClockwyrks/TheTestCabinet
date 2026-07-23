# Gameplay

## Overview

This file defines the run: the deterministic simulation the game advances on, the
opening build phase, the build phases between waves, the progression of waves, the
milestone waves, difficulty scaling, the lives you lose to leaks, and victory and
loss. The screens and menus, the HUD, and the game's audio are defined in
`specs/ui.md`. It refers to the floor in `specs/playfield.md`, the surge in
`specs/surge.md`, the economy in `specs/economy.md`, the controls in
`specs/controls.md`, and the modes and difficulties in `specs/modes.md`.

The numeric values here are fixed; implement them exactly as written.

## The simulation

The simulation runs on a fixed timestep of 60 Hz — one simulation step is exactly
1/60 of a second of game time — decoupled from rendering, so movement, firing, heat,
and pathing are reproducible and independent of the render frame rate. The rate is
fixed at 60 Hz rather than chosen by the build: the debug API of
`specs/instrumentation.md` advances the simulation in whole steps, and a step is only
a unit of time if its length is fixed. State advances by stepping this fixed-timestep
update, and rendering only reads the state, so the core makes progress without a
canvas or the wall clock. Any randomness the game uses (which vent each unit enters
from, spawn timing jitter, and any variation the special modes introduce) runs off a
seedable generator, so reseeding and replaying the same inputs reproduces the same
result exactly. The game-speed control (`specs/controls.md`) changes how many
simulation steps run per real second; it does not change the outcome of the
simulation, only how fast it plays.

Given the same seed and the same sequence of inputs and steps, the game reaches the
same state every time. `specs/instrumentation.md` builds its debug and automation
surface on this core.

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
- Milestone waves. The final wave (Wave `N`) is a Core boss wave (`specs/surge.md`),
  and one earlier milestone wave near the midpoint of the run (`round(N / 2)`) is too.
  In the standard 20-wave Medium run these are Wave 10 and Wave 20.
- Difficulty scaling. Surge HP scales with the wave number `w`: a unit's HP is its base
  HP (`specs/surge.md`) times `1 + 0.62 * (w - 1)` (so a Medium Wave 20 unit has about
  12.8x its base HP, and a longer run climbs higher). Counts also grow across the run.
  The volume types (Motes, Swarms) field large, dense waves that press the player's
  many-tower maze, while the Hulk and Drift waves are smaller but far tankier or
  airborne (`specs/surge.md`). Speeds, bounties, and leak values do not scale. All other
  systems (heat, coupling, the towers) are unchanged across waves.
- Victory. Surviving the final wave (Wave `N`), clearing it with at least one life
  left, wins the game (the Victory state, `specs/ui.md`). A special mode may define
  its own win condition (`specs/modes.md`: The Hundred is won by clearing its whole
  100-unit onslaught).

## Lives and leaks

- You start with 20 lives.
- When a surge unit reaches an exhaust (`specs/playfield.md`) it leaks, costing its leak
  value in lives (`specs/surge.md`: most units are worth 1, a Hulk is worth 2, and a
  Core is worth 5) and is removed.
- Lives never regenerate. If lives reach 0 or below, the reactor breaches and the game
  ends (the Game over state, `specs/ui.md`), even mid-wave.
