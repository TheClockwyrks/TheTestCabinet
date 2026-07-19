# Flow

## Overview

This file defines the playable mode, the simulation model, scoring, lives, the
timer, the level progression and victory, the game's state machine, the HUD, and
audio. It refers to the strait in `specs/playfield.md`, the hunter in
`specs/hunter.md`, the hazards in `specs/hazards.md`, the water in `specs/water.md`,
and the controls in `specs/controls.md`.

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

- Fixed timestep. The simulation advances in fixed steps of a constant size,
  accumulated from frame to frame, so the physics is independent of frame rate.
- Render-free core. Game state advances by stepping the simulation and does not
  depend on a canvas, on `requestAnimationFrame`, or on wall-clock time to make
  progress. Rendering reads the state, never the other way around.
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
- On losing a life: the current crossing ends, the bear is removed
  (`specs/hunter.md`), and a fresh critter respawns on the near shore with the timer
  reset. The filled bays stay filled (you resume the same level). A short spawn-in
  pause before the bear re-emerges keeps you from being caught instantly.
- Lives never regenerate during a level, but a bonus life is awarded at every
  `10,000` points of score. If lives reach 0, the game ends (Game over, below).

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
  below).

## Scoring

A score accumulates across the run and shows in the HUD and end screens. It is the
aggregation of the following:

- `+ 10` for each row advanced upward (net new progress toward the far shore), so
  pushing forward scores.
- `+ 50` for reaching a bay, plus a time bonus of `+ 2` per whole second left on the
  crossing timer.
- `+ 100 * level` for clearing a level (filling its fifth bay).
- `+ 250 * livesRemaining` awarded at Victory.

A bonus catch, a small fish, appears in one randomly chosen open bay and lingers
there for `5 s` before moving to another open bay; at most one is present at a time,
and a new one appears about every `8 s`. Completing a crossing into the bay that
holds the fish scores `+ 200`. Score is for the end-screen result and bragging
rights only; it does not affect play (lives, timer, or level progression) and is not
persisted between sessions.

## Game States

The game is a small state machine. Each state has a clear screen and controls
(controls are defined in `specs/controls.md`).

1. Title / main menu. Shows the title `FLOE`, the tagline `DON'T LOOK BACK`, and a
   vertical menu: `CROSS` to begin, then `HOW TO PLAY`. The selected item is
   highlighted. A dim slice of the strait (ice, water, a floe, the bear) may show
   behind the menu for atmosphere.
2. How to play. Describes the goal (cross the strait and fill all the bays), the
   controls, that a bear hunts you across the whole strait and only your speed keeps
   you ahead, the sliding ice hazards, riding the drifting floes (and not drifting
   off the edge), and the timer. Returns to the menu.
3. In game. The live game: the strait and its bands, the hazards sliding and the
   floes drifting, the critter hopping, the bear pursuing, and the HUD.
4. Paused. Reachable in game. Offers Resume, Restart, and Quit to menu. The strait
   is visible but frozen behind the pause menu.
5. Victory. Shown when level 8 is cleared. Displays the final score, levels cleared
   (all 8), and lives remaining, with `PLAY AGAIN` and `MENU`.
6. Game over. Shown when lives reach 0. Displays the final score and the level
   reached, with `PLAY AGAIN` and `MENU`.

## HUD

The HUD lives in the top bar (`specs/playfield.md`): score, lives (as critter icons
or a count), the level indicator (`LEVEL n / 8`), and the crossing timer (a draining
bar or countdown). A row of bay markers showing which of the 5 bays are filled is
encouraged. The HUD bar is always fully visible above the strait
(`specs/overview.md`).

## Audio

Audio is required: synthesize it with the Web Audio API (no audio files), with
distinct short cues for a hop, splashing into the water, being crushed by a hazard,
the bear catching you, filling a bay, clearing a level, and the Victory and Game-over
stings. The game stays fully playable with sound muted and never fails to run or load
if audio cannot start. Provide a mute toggle, and do not start audio until the player
first interacts (browsers block autoplay).

## Out of scope

- Network or online multiplayer, and any saved or persisted progress between
  sessions (including high scores).
- Touch or gamepad input (keyboard only for this version).
- A level editor, alternate straits, or difficulty menus: this version is the one
  strait and the one 8-level run.
- Power-ups or weapons: the critter cannot fight the bear or the hazards, only cross.
