# Flow

## Overview

This file defines scoring, lives, the timer, the level progression and victory,
the
game's state machine, the HUD, audio, and what is out of scope. It refers to the
strait in `specs/playfield.md`, the hunter in `specs/hunter.md`, the hazards in
`specs/hazards.md`, the water in `specs/water.md`, the controls in
`specs/controls.md`, and the playable mode in `specs/standard.md`.

The numeric values here are **fixed**; implement them exactly as written.

## Lives and death

- You start a game with **3 lives**.
- The critter **loses a life** when it is caught by the bear (`specs/hunter.md`),
  hit by a sliding hazard (`specs/hazards.md`), falls in the water or is swept off
  the edge on a floe (`specs/water.md`), or the crossing **timer** runs out (below).
- On losing a life: the current crossing ends, the bear is removed
  (`specs/hunter.md`), and a fresh critter respawns on the **near shore** with the
  timer reset — the **filled bays stay filled** (you resume the same level). A
  short spawn-in pause before the bear re-emerges is required so you are not caught
  instantly.
- Lives never regenerate during a level. You may award a **bonus life** at a score
  threshold (for example every `10,000` points) — optional and tunable. If lives
  reach **0**, the game ends (Game over, below).

## The timer

Each crossing (each trip from the near shore) is under a **timer**: about **30 s**
at level 1. It drains while the critter is crossing; **reaching a bay resets it**
for the next crossing. If it reaches zero before the critter reaches a bay, the
critter **loses a life**. The timer shortens with the level (below), and it is a
second pressure alongside the bear — but the bear is the immediate one.

## Levels and Victory

- A game is a fixed run of **8 levels**, numbered `LEVEL 1` … `LEVEL 8`.
- A level is **cleared** by **filling all 5 bays** (`specs/playfield.md`): the
  critter must complete five successful crossings, each ending in a different open
  bay. Clearing a level advances to the next; the bays reset to empty for the new
  level.
- **Difficulty scaling.** Each level, the hazard and floe **lane speeds** increase
  by about `+6%` (`specs/hazards.md`, `specs/water.md`), the **bear** speeds up
  by
  about `+6%` (`specs/hunter.md`), and the crossing **timer** shortens. From
  **level 5** a **second bear** hunts (`specs/hunter.md`). The per-level lane
  composition follows the rules in these specs.
- **Victory.** Clearing **level 8** — filling its last bay — **wins** the game (the
  Victory state, below).

## Scoring

A **score** accumulates across the run and shows in the HUD and end screens. It
is
the aggregation of the following (all values tunable):

- `+ 10` for each **row advanced** upward (net new progress toward the far shore),
  so pushing forward scores.
- `+ 50` for reaching a **bay**, plus a **time bonus** of `+ 2` per whole second
  left on the crossing timer.
- `+ 100 * level` for **clearing a level** (filling its fifth bay).
- `+ 250 * livesRemaining` awarded at **Victory**.

Optionally, a **bonus catch** (a small fish that occasionally appears in an open
bay) may be worth extra points if the critter fills that bay while it is there —
optional and tunable. Score is for the end-screen result and bragging rights only;
it does not affect play and is **not persisted** between sessions.

## Game States

The game is a small state machine. Each state has a clear screen and controls
(controls are defined in `specs/controls.md`).

1. **Title / main menu.** Shows the title `FLOE`, the tagline `DON'T LOOK BACK`,
   and a vertical menu with the playable mode's entry (defined by the `standard`
   spec), followed by `HOW TO PLAY`. The selected item
   is highlighted. A dim slice of the strait — ice, water, a floe, the bear — may
   show behind the menu for atmosphere.
2. **How to play.** Describes the goal (cross the strait and fill all the bays),
   the
   controls, that a bear hunts you across the whole strait and only your speed keeps
   you ahead, the sliding ice hazards, riding the drifting floes (and not drifting
   off the edge), and the timer. Returns to the menu.
3. **In game.** The live game: the strait and its bands, the hazards sliding and
   the
   floes drifting, the critter hopping, the bear pursuing, and the HUD.
4. **Paused.** Reachable in game. Offers **Resume**, **Restart**, and **Quit to
   menu**. The strait is visible but frozen behind the pause menu.
5. **Victory.** Shown when level 8 is cleared. Displays the final **score**,
   **levels cleared** (all 8), and **lives remaining**, with **PLAY AGAIN** and
   **MENU**.
6. **Game over.** Shown when lives reach `0`. Displays the final **score** and the
   **level reached**, with **PLAY AGAIN** and **MENU**.

## HUD

The HUD lives in the top bar (`specs/playfield.md`): **score**, **lives** (as
critter icons or a count), the **level indicator** (`LEVEL n / 8`), and the
crossing **timer** (a draining bar or countdown). A row of **bay markers** showing
which of the 5 bays are filled is encouraged. The HUD bar must always be fully
visible above the strait (`specs/overview.md`).

## Audio

Audio is recommended but optional, and must never be required for the game to run
or load. If included, synthesize it with the Web Audio API (no audio files):
distinct short cues for a hop, splashing into the water, being crushed by a hazard,
**the bear catching you**, filling a bay, clearing a level, and the Victory/Game-
over stings. Provide a mute toggle, and do not start audio until the player
interacts (browsers block autoplay).

## Key Behaviors

The game must exhibit these behaviors. They are observable and make good test
targets:

- **The bear hunts across the whole strait:** it emerges at the near shore and
  **hops** (one tile at a time, like the critter) after the critter's position over
  ice, floes, and water (swimming), routing around the vehicles — and if a vehicle
  catches it, it is **reset** (removed and re-emerging from the near shore), so
  you
  can lure it into traffic. It catches a critter that hesitates or errs
  (`specs/hunter.md`).
- **One-tile hops only:** the critter moves exactly one tile per hop, four
  directions, with no long or charged jump (`specs/controls.md`).
- **Ice band:** solid lanes of sliding multi-tile vehicles — a 3-tile snow
  plow, a 2-tile dogsled, and a 2-tile car; contact is death
  (`specs/hazards.md`).
- **Water band:** deadly water crossed on drifting floes that **carry** the
  critter —
  1-tile pans and solid 3-/4-tile rafts; falling in or drifting off the edge is
  death
  (`specs/water.md`).
- **Bays:** the critter fills the 5 bays across the far shore; filled bays are safe
  and block re-entry; filling all 5 clears the level (`specs/playfield.md`).
- **Lives, timer, and levels:** a caught/crushed/drowned critter or an expired timer
  costs a life; `0` lives ends the game; clearing level 8 wins it.

## Out of scope

- Network or online multiplayer, and any saved/persisted progress between sessions
  (including high scores).
- Touch or gamepad input (keyboard only for this version).
- A level editor, alternate straits, or difficulty menus — this version is the one
  strait and the one 8-level run.
- Power-ups or weapons — the critter cannot fight the bear or the hazards, only
  cross.
