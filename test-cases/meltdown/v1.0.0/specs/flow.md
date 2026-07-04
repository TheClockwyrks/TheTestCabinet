# Flow

## Overview

This file defines the economy, lives, the wave progression and victory, scoring,
the game's state machine, the HUD's meaning, audio, and what is out of scope. It
refers to the floor in `specs/playfield.md`, the heat system in `specs/heat.md`,
the towers in `specs/towers.md`, the surge in `specs/creeps.md`, the controls in
`specs/controls.md`, and the modes under `specs/modes/`.

The numeric values here are the **starting balance**, meant to be tuned by play;
implement them as written but keep them easy to adjust.

## Money and Economy

Money is what gates how fast your maze can grow, so the surge always presses
against a defense that is still being built up.

- You start a game with `250` money.
- **Bounties.** Killing a surge unit pays its **bounty** (`specs/creeps.md`)
  immediately.
- **Wave-clear bonus.** Clearing a wave (the last unit of it dies or leaks) pays
  a flat `20` plus `5 * waveNumber`.
- **Interest.** At the start of each build phase between waves, you earn
  `8%` of your current money as interest, rounded down and capped at
  `+40` per build phase — a gentle reward for not over-spending, so banking to
  upgrade later is a real option.
- **Early-send bonus.** Sending the next wave early (`specs/controls.md`) pays a
  bonus of `1` per whole second left on the build-phase timer when you send
  it, rewarding an aggressive player who is ready before the timer.
- You spend money to **build** and **upgrade** towers and recover `70%` of a
  tower's total spend by **selling** it (`specs/towers.md`). You can never spend
  below `0`.

## Lives and Leaks

- You start with `20` lives.
- When a surge unit reaches an **exhaust** (`specs/playfield.md`) it **leaks**,
  costing its leak value in lives (`specs/creeps.md`: most units are worth `1`,
  a Hulk is worth `2`, and a Core is worth `5`) and is removed.
- Lives never regenerate. If lives reach `0` or below, the reactor breaches
  and the game ends (Game over, below) — even mid-wave.

## Waves and Victory

- A game is a fixed run of `20` waves on the one floor. Waves are numbered
  `WAVE 1` … `WAVE 20`.
- Between waves there is a **build phase** of up to `15 s` (its countdown
  shown in the build panel), during which the surge is not spawning and you
  build, upgrade, sell, and re-shape the maze. Interest is paid at its start.
  You may choose to send the next wave early (`specs/controls.md`) for the
  early-send bonus, or let the timer expire to start it automatically. There is
  a build phase before Wave 1 as well, so the player can lay an opening
  maze.
- During a wave, the surge spawns from the intakes over time (you design the
  exact timing and intake split, `specs/creeps.md`). A wave is **cleared** when
  every unit it released has either died or leaked. Clearing a wave pays its
  bonus and begins the next build phase.
- **Milestone waves.** Wave 10 and Wave 20 each include a **Core** boss
  (`specs/creeps.md`) amid the surge.
- **Difficulty scaling.** Surge HP scales with the wave number `w`: a unit's
  HP is its base HP (`specs/creeps.md`) times `1 + 0.15 * (w - 1)`. Counts
  grow toward the late game as you design the waves. Speeds, bounties, and leak
  values do not scale. All other systems (heat, coupling, the towers) are
  unchanged across waves.
- **Victory.** Surviving Wave 20 — clearing it with at least one life left —
  **wins** the game (the Victory state, below).

## Scoring

A **score** accumulates across the run and shows in the HUD/end screens. It is
the aggregation of the following values:

- `+ bounty` for each unit killed (same value as the money bounty).
- `+ 100 * waveNumber` for each wave cleared.
- `+ 250 * livesRemaining` awarded at Victory.

Score is for the end-screen result and bragging rights only; it does not affect
play and is **not persisted** between sessions.

## Game States

The game is a small state machine. Each state has a clear screen and controls
(controls are defined in `specs/controls.md`).

1. **Title / main menu.** Shows the title `MELTDOWN`, the tagline `RUN IT HOT`,
   and a vertical menu listing the playable modes defined by the mode specs
   (each mode spec declares its own entry), followed by `HOW TO PLAY`. The
   selected item is highlighted. A dim slice of reactor floor with a few glowing
   towers may show behind the menu for atmosphere.
2. **How to play.** Describes the goal (stop the surge from reaching the
   exhausts), the controls, heat as power and the redline trip, the Forge
   and Vent, the heat-averse Rime, flyers, air-capable emitters, air-only Flak,
   and the economy. Returns
   to the menu.
3. **In match.** The live game: the floor and its maze, the surge walking and
   flying, the towers firing and heating, and the build panel. This covers both
   the **build phase** (countdown running, no surge spawning) and the **wave
   phase** (surge active); building is allowed in both (`specs/controls.md`).
4. **Paused.** Reachable in match. Offers **Resume**, **Restart**, and **Quit to
   menu**. The floor is visible but frozen behind the pause menu.
5. **Victory.** Shown when Wave 20 is cleared with lives remaining. Displays the
   final **score**, **waves survived** (all 20), and **lives remaining**, with
   **PLAY AGAIN** and **MENU**.
6. **Game over.** Shown when lives reach `0`. Displays the final **score** and
   the **wave reached**, with **PLAY AGAIN** and **MENU**.

## HUD

The HUD lives in the build panel (`specs/playfield.md`): **money**, **lives**,
and the **wave indicator** (`WAVE n / 20` with a read of the current wave's
progress or the build-phase countdown) as status readouts; the **shop**; the
**selected-tower inspector** with the selected tower's live **heat read**; and
the **wave controls** (send next wave with its bonus, the `1x`/`2x` speed
toggle, and pause). The build panel must always be fully visible
(`specs/overview.md`). On the floor, towers carry their own at-a-glance **heat
read** (`specs/overview.md`, `specs/heat.md`) and surge units carry health bars
(`specs/creeps.md`).

A **next-wave preview** — what types the coming wave contains — should be shown
during the build phase (in the panel or as a banner) so the player can re-shape
the maze for it.

## Audio

Audio is recommended but optional, and must never be required for the game to
run or load. If included, synthesize it with the Web Audio API (no audio files):
distinct short cues for placing a tower, an emitter firing, a tower **tripping
the redline**, a unit dying, a unit leaking (a life lost), a wave starting,
clearing a wave, and the Victory/Game-over stings. Provide a mute toggle, and do
not start audio until the player interacts (browsers block autoplay).

## Key Behaviors

The game must exhibit these behaviors. They are observable and make good test
targets:

- **Towers are walls and you build the maze:** the surge pathfinds the shortest
  open route from each intake to its **opposite exhaust** (left to right, top to
  bottom), re-paths live when a tower is built or sold, and a placement that
  would seal either required route is **refused** (`specs/playfield.md`).
- **Heat is power:** an emitter's damage climbs with its heat on the
  accelerating curve, and a tower that reaches the redline trips offline for `3
  s` (`specs/heat.md`).
- The **Forge** pours heat into adjacent emitters (asset in a lull, liability in
  a push) and the **Vent** draws it out, both only across orthogonal footprint
  edge contact, scaled by tower alignment (`specs/heat.md`).
- The **Rime** is **heat-averse** — it slows hardest when cold and degrades as
  it heats (`specs/towers.md`).
- **Flyers ignore the maze**; every emitter can hit them in range, while
  **Flak** is air-only and provides dedicated flyer coverage
  (`specs/creeps.md`, `specs/towers.md`).
- The six emitters behave per their stances; towers can be **upgraded**
  (stronger and hotter) and **sold** (`specs/towers.md`); the **economy** runs
  on bounties, the wave bonus, interest, and the early-send bonus.
- A leaked unit **costs lives**; `0` lives ends the game; clearing Wave
  20 wins it.

## Out of scope

- Network or online multiplayer, and any saved/persisted progress between
  sessions.
- Touch or gamepad input (mouse and keyboard only for this version).
- A map editor, multiple maps, or procedurally generated floors — this version
  is the one fixed floor of `specs/playfield.md`.
- An in-run research/tech tree beyond the per-tower upgrades of
  `specs/towers.md`.
