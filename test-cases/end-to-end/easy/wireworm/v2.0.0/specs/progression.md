# Progression

## Overview

This file defines lives, the level progression and victory, and scoring. It refers
to the board in `specs/board.md`, the charge system in `specs/charge.md`, the worm
in `specs/worm.md`, and the foes in `specs/foes.md`. The game states, HUD, and
audio are in `specs/ui.md`.

The numeric values here are fixed; implement them exactly as written.

## Lives

- You start a game with 3 lives.
- You lose a life when a worm segment reaches the cursor, or when a foe (glitch,
  dropper, or corruptor) touches the cursor (`specs/foes.md`).
- On losing a life: briefly clear the board of the current worm(s) and foes, then
  respawn the cursor centered in the band and spawn the level's worm afresh from
  the top after a short pause. The node field is left standing (it is not cleared);
  only the worm and foes reset. A short spawn-in invulnerability while the cursor
  reappears is encouraged so you are not hit twice instantly.
- A bonus life is awarded at every `12,000` points of score.
- If lives reach 0, the game ends (Game over, in `specs/ui.md`).

## Levels and victory

- A game is a fixed run of 12 levels through the persistent node field
  (`specs/board.md`), numbered `LEVEL 1` through `LEVEL 12`.
- Each level descends one worm of the length in `specs/worm.md`, quickening per
  level, with foes appearing per their level gates (`specs/foes.md`).
- A level is cleared when every worm segment is gone (`specs/worm.md`). Clearing a
  level pays its clear bonus and advances to the next level; the node field
  standing at that moment carries into the next level, so the board only ever gets
  denser (until you thin it with discharges).
- Victory. Clearing level 12 with at least one life remaining wins the game (the
  Victory state, in `specs/ui.md`).

## Scoring

A score accumulates across the run and shows in the HUD and end screens. It is the
aggregation of the following:

- Worm segments: `+ 10` for a body segment, `+ 100` for a head, destroyed by a
  shot; a segment fried by a discharge also scores `+ 10`.
- Discharge purge: `+ 5` for each node cleared by a discharge (`specs/charge.md`),
  rewarding a big chain.
- Node shot down: `+ 1` for an inert node destroyed by a bolt.
- Foes: `+ 300` for a glitch, `+ 200` for a packet-dropper, `+ 1000` for a
  corruptor (`specs/foes.md`).
- Level clear: `+ 100 * level`.
- Victory: `+ 250 * livesRemaining` awarded on winning.

Score is for the end-screen result only; it does not affect play and is not
persisted between sessions.
