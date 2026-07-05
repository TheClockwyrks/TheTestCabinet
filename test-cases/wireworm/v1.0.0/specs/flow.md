# Flow

## Overview

This file defines scoring, lives, the level progression and victory, the game's
state machine, the HUD, audio, and what is out of scope. It refers to the
board in
`specs/playfield.md`, the charge system in `specs/charge.md`, the worm in
`specs/worm.md`, the foes in `specs/foes.md`, the controls in `specs/controls.md`,
and the modes under `specs/modes/`.

The numeric values here are a **starting balance**, meant to be tuned by play;
implement them as written but keep them easy to adjust.

## Lives

- You start a game with **3 lives**.
- You **lose a life** when a **worm segment** reaches the cursor, or when a **foe**
  (glitch, dropper, or corruptor) touches the cursor (`specs/foes.md`).
- On losing a life: briefly clear the board of the current worm(s) and foes, then
  respawn the cursor centered in the band and spawn the level's worm afresh from
  the top after a short pause. The **node field is left standing** (it is not
  cleared) — only the worm and foes reset. A short spawn-in invulnerability while
  the cursor reappears is encouraged so you are not hit twice instantly.
- Lives never regenerate during a level. You may award a **bonus life** at a score
  threshold (for example every `12,000` points) — optional and tunable.
- If lives reach **0**, the game ends (Game over, below).

## Levels and Victory

- A game is a fixed run of **12 levels** through the **persistent** node field
  (`specs/playfield.md`), numbered `LEVEL 1` … `LEVEL 12`.
- Each level descends one worm of the length in `specs/worm.md`, quickening per
  level, with foes appearing per their level gates (`specs/foes.md`). You design
  the exact spawn timing and any per-level foe cadence.
- A level is **cleared** when every worm segment is gone (`specs/worm.md`).
  Clearing a level pays its clear bonus and advances to the next level; the node
  field standing at that moment carries into the next level, so the board only ever
  gets denser (until you thin it with discharges).
- **Victory.** Clearing **level 12** with at least one life remaining **wins** the
  game (the Victory state, below).

## Scoring

A **score** accumulates across the run and shows in the HUD and end screens.
It is
the aggregation of the following (all values tunable):

- **Worm segments:** `+ 10` for a body segment, `+ 100` for a head,
  destroyed by a
  shot; a segment fried by a **discharge** also scores `+ 10`.
- **Discharge purge:** `+ 5` for each node cleared by a discharge (`specs/charge.md`),
  rewarding a big chain.
- **Node shot down:** `+ 1` for an inert node destroyed by a bolt.
- **Foes:** `+ 300` for a glitch, `+ 200` for a packet-dropper, `+ 1000` for a
  corruptor (`specs/foes.md`).
- **Level clear:** `+ 100 * level`.
- **Victory:** `+ 250 * livesRemaining` awarded on winning.

Score is for the end-screen result and bragging rights only; it does not affect
play and is **not persisted** between sessions.

## Game States

The game is a small state machine. Each state has a clear screen and controls
(controls are defined in `specs/controls.md`).

1. **Title / main menu.** Shows the title `WIREWORM`, the tagline `CUT THE
   CURRENT`, and a vertical menu listing the playable modes defined by the mode
   specs (each mode spec declares its own entry), followed by `HOW TO PLAY`. The
   selected item is highlighted. A dim slice of board with a few glowing nodes and
   a worm may show behind the menu for atmosphere.
2. **How to play.** Describes the goal (cut the worm apart before it reaches your
   band), the controls, the charge field and the chain-arc discharge, that
   critical nodes make the worm dive, that shooting the worm grows the field, and
   the three foes. Returns to the menu.
3. **In game.** The live game: the board and its node field, the worm winding and
   diving, your cursor firing, foes, discharges, and the HUD.
4. **Paused.** Reachable in game. Offers **Resume**, **Restart**, and **Quit to
   menu**. The board is visible but frozen behind the pause menu.
5. **Victory.** Shown when level 12 is cleared with lives remaining. Displays the
   final **score**, **levels cleared** (all 12), and **lives remaining**, with
   **PLAY AGAIN** and **MENU**.
6. **Game over.** Shown when lives reach `0`. Displays the final **score** and the
   **level reached**, with **PLAY AGAIN** and **MENU**.

## HUD

The HUD lives in the top bar (`specs/playfield.md`): **score**, **lives** (as
cursor icons or a count), and the **level indicator** (`LEVEL n / 12`). A compact
**hazard indicator** (a corruptor or dropper being active) is encouraged. The HUD
bar must always be fully visible above the board (`specs/overview.md`). On the
board, nodes show their charge by sprite (`specs/charge.md`), and the worm and
foes carry no health bars.

## Audio

Audio is recommended but optional, and must never be required for the game to run
or load. If included, synthesize it with the Web Audio API (no audio files):
distinct short cues for firing a bolt, cutting a worm segment, **a chain-arc
discharge going off**, a node reaching critical, killing a foe, losing a life,
clearing a level, and the Victory/Game-over stings. Provide a mute toggle, and do
not start audio until the player interacts (browsers block autoplay).

## Key Behaviors

The game must exhibit these behaviors. They are observable and make good test
targets:

- **Charge builds and discharges:** the worm charges nodes it bumps toward
  critical, and shooting a critical node sets off a chain-arc that clears the
  charged cluster and cleanly fries the worm through it (`specs/charge.md`).
- **Shooting grows the field, discharges thin it:** every shot-killed worm segment
  leaves a node; discharge-killed segments leave none (`specs/worm.md`,
  `specs/charge.md`).
- **Critical nodes make the worm dive** straight down (`specs/charge.md`,
  `specs/worm.md`).
- **The worm winds and splits:** it drops-and-reverses on collision,
  oscillates at
  the bottom, dives on criticals; a mid-segment shot splits it into two worms, an
  end shot shortens it (`specs/worm.md`).
- **The cursor is band-bound** and fires straight up (`specs/controls.md`); a worm
  segment or foe reaching it costs a life.
- **The three foes** behave per their roles — the glitch eats nodes, the dropper
  reseeds a sparse field (two hits), the corruptor slams a critical line
  (`specs/foes.md`).
- **The field persists across levels**; `0` lives ends the game;
  clearing level 12
  wins it.

## Out of scope

- Network or online multiplayer, and any saved/persisted progress between sessions
  (including high scores).
- Touch or gamepad input (mouse and keyboard only for this version).
- A level editor, alternate boards, or difficulty menus — this version is the one
  board and the one 12-level run.
- Power-ups, weapon upgrades, or an economy/shop — the cursor's one weapon is the
  upward bolt.
