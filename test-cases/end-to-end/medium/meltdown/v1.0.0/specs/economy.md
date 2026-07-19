# Economy

## Overview

This file defines the money, bounties, interest, and bonuses that fund your defense,
the lives you lose to leaks, and the score the end screens show. It refers to the
floor in `specs/reactor.md`, the towers in `specs/towers.md`, the surge in
`specs/surge.md`, the run in `specs/waves.md`, and the modes and difficulties in
`specs/modes.md`.

The numeric values here are fixed; implement them exactly as written.

## Money and economy

Money is what gates how fast your maze can grow, so the surge always presses against
a defense that is still being built up.

- Your starting money is set by the selected mode and difficulty (`specs/modes.md`);
  the standard Medium start is 250, enough to lay an opening maze of about 16 basic
  Arc towers (`specs/towers.md`), so the first build is already a real maze, not a
  couple of towers.
- Bounties. Killing a surge unit pays its bounty (`specs/surge.md`) immediately.
- Wave-clear bonus. Clearing a wave (the last unit of it dies or leaks) pays a flat 20
  plus `5 * waveNumber`.
- Interest. At the start of each build phase between waves, you earn 8% of your current
  money as interest, rounded down and capped at +40 per build phase, a gentle reward
  for not over-spending, so banking to upgrade later is a real option. Some modes
  disable interest (`specs/modes.md`).
- Early-send bonus. Sending the next wave early (`specs/controls.md`) pays a bonus of 1
  per whole second left on the build-phase timer when you send it, rewarding an
  aggressive player who is ready before the timer.
- You spend money to build and upgrade towers and recover 70% of a tower's total spend
  by selling it, or its full spend if you sell it during the same build phase you
  placed it on, before that wave starts, so a tower that never fought is fully
  refundable (`specs/towers.md`). You can never spend below 0.

## Lives and leaks

- You start with 20 lives.
- When a surge unit reaches an exhaust (`specs/reactor.md`) it leaks, costing its leak
  value in lives (`specs/surge.md`: most units are worth 1, a Hulk is worth 2, and a
  Core is worth 5) and is removed.
- Lives never regenerate. If lives reach 0 or below, the reactor breaches and the game
  ends (`specs/states.md`), even mid-wave.

## Scoring

A score accumulates across the run and shows in the HUD and end screens. It is the
aggregation of the following values:

- `+ bounty` for each unit killed (same value as the money bounty).
- `+ 100 * waveNumber` for each wave cleared.
- `+ 250 * livesRemaining` awarded at Victory.

Score is for the end-screen result and bragging rights only; it does not affect play
and is not persisted between sessions.
