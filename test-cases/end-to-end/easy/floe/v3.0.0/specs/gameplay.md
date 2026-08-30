# Gameplay

## Overview

This file defines the playable mode, the simulation model, scoring, lives, the
timer, and the level progression and victory. The screens and menus, the HUD, and
audio are defined in `specs/ui.md`. It refers to the strait in `specs/playfield.md`,
the hunter in `specs/hunter.md`, the hazards in `specs/hazards.md`, the water in
`specs/water.md`, and the controls in `specs/controls.md`.

The numeric values here are fixed; implement them exactly as written.

## The mode

Floe is one game: a single-strait run. From the main menu the player chooses `CROSS`
to begin. You take the critter across the one strait of `specs/playfield.md` across
all 8 levels, filling the five far-shore bays each level, dodging the sliding ice
hazards, riding the drifting floes without falling in or drifting off the edge,
beating the crossing timer, and above all keeping ahead of the hunting bear
(spending the hazards and the water's tempo against it), until level 8 is cleared or
your lives run out. The run uses every system exactly as these specs define it.

## The simulation

The game runs on a deterministic, fixed-timestep simulation, decoupled from
rendering:

- Fixed timestep. The simulation advances in fixed steps of exactly `1/120` of a
  second — a rate of `120 Hz` — accumulated from frame to frame, so the physics is
  independent of frame rate. The rate is fixed and not an implementation choice: one
  step is always the same length, which is what makes a step a unit of time a caller
  can count in (`specs/instrumentation.md`).
- Render-free core. Game state advances by stepping the simulation and does not
  depend on a canvas, on `requestAnimationFrame`, or on wall-clock time to make
  progress. The dependency runs one way: the simulation never reads from, waits
  on, or is driven by the renderer.
- Seeded randomness. Any randomness the game uses, such as which open bay the
  bonus-catch fish appears in (below) and the lanes' spawn phases, runs off a
  seedable generator, so reseeding and replaying the same inputs reproduces the same
  result exactly.

Given the same seed and the same sequence of inputs and steps, the game reaches the
same state every time. `specs/instrumentation.md` builds its debug and automation
surface on this core.

## Lives and death

- You start a game with 3 lives.
- The critter loses a life when it is caught by the bear (`specs/hunter.md`),
  crushed by a sliding hazard that slides into it (`specs/hazards.md`), falls in the
  water or is swept off the edge on a floe (`specs/water.md`), or the crossing timer
  runs out (below).
- On losing a life: the current crossing ends and the game holds for a brief death
  pause of about `1 s` before a fresh critter respawns on the near shore with the
  timer reset and the bear removed (`specs/hunter.md`). The filled bays stay filled
  (you resume the same level). A further short spawn-in pause before the bear
  re-emerges keeps you from being caught instantly.
- Every death has that pause, whatever caused it — the bear, a hazard, the water, or
  the timer. For its duration the critter is out of play: it is not on the board to be
  moved, and nothing can kill it again, while the strait around it keeps moving.
- Lives never regenerate during a level, but a bonus life is awarded at every
  `10,000` points of score. If lives reach 0, the game ends (the Game-over state,
  `specs/ui.md`).

## The timer

Each crossing (each trip from the near shore) is under a timer: about `30 s` at
level 1. It drains while the critter is crossing, and reaching a bay resets it for
the next crossing. If it reaches zero before the critter reaches a bay, the critter
loses a life. The timer shortens with the level (below), and it is a second pressure
alongside the bear.

## Levels and Victory

- A game is a fixed run of 8 levels, numbered `LEVEL 1` … `LEVEL 8`.
- A level is cleared by filling all 5 bays (`specs/playfield.md`): the critter must
  complete five successful crossings, each ending in a different open bay. Clearing a
  level advances to the next; the bays reset to empty for the new level.
- Difficulty scaling. Each level, the hazard and floe lane speeds increase by about
  `+6%` (`specs/hazards.md`, `specs/water.md`), the bear speeds up by about `+6%`
  (`specs/hunter.md`), and the crossing timer shortens. From level 5 a second bear
  hunts (`specs/hunter.md`). The per-level lane composition follows the rules in
  these specs.
- Victory. Clearing level 8 (filling its last bay) wins the game (the Victory state,
  `specs/ui.md`).

## Scoring

A score accumulates across the run and shows in the HUD and end screens. It is the
aggregation of the following:

- `+ 10` for each row advanced upward (net new progress toward the far shore), so
  pushing forward scores. Every row counts the same way, including the bay row
  (row 1, `specs/playfield.md`), so the hop that completes a crossing scores its row
  like any other.
- `+ 50` for reaching a bay, plus a time bonus of `+ 2` per whole second left on the
  crossing timer. This is on top of that final row, so a crossing completed with `T`
  whole seconds left scores `10 + 50 + 2 * T` on its last hop.
- `+ 100 * level` for clearing a level (filling its fifth bay).
- `+ 250 * livesRemaining` awarded at Victory.

A bonus catch, a small fish, appears in one randomly chosen open bay and lingers
there for `5 s` before moving to another open bay; at most one is present at a time,
and a new one appears about every `8 s`. Completing a crossing into the bay that
holds the fish scores `+ 200`. Score is for the end-screen result and bragging
rights only; it does not affect play (lives, timer, or level progression) and is not
persisted between sessions.

The screens and menus this progression moves between (the title and how-to-play
screens, the pause menu, and the Victory and Game-over screens), the HUD that shows
the score, lives, level, and timer during play, and the game's audio are all defined
in `specs/ui.md`.

## Out of scope

- Network or online multiplayer, and any saved or persisted progress between
  sessions (including high scores).
- Touch or gamepad input (keyboard only for this version).
- A level editor, alternate straits, or difficulty menus: this version is the one
  strait and the one 8-level run.
- Power-ups or weapons: the critter cannot fight the bear or the hazards, only cross.
