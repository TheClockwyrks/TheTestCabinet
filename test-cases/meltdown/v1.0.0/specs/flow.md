# Flow

## Overview

This file defines the economy, lives, the wave progression and victory, scoring,
the game's state machine, the HUD's meaning, and what is out of scope. It
refers to the floor in `specs/playfield.md`, the heat system in `specs/heat.md`,
the towers in `specs/towers.md`, the surge in `specs/creeps.md`, the controls in
`specs/controls.md`, and the modes and difficulties in `specs/modes.md`.

The numeric values here are **fixed**; implement them exactly as written.

## Money and Economy

Money is what gates how fast your maze can grow, so the surge always presses
against a defense that is still being built up.

- Your **starting money** is set by the selected mode and difficulty
  (`specs/modes.md`); the standard **Medium** start is `250` — enough to lay an
  opening maze of about **16** basic Arc towers (`specs/towers.md`), so the first
  build is already a real maze, not a couple of towers.
- **Bounties.** Killing a surge unit pays its **bounty** (`specs/creeps.md`)
  immediately.
- **Wave-clear bonus.** Clearing a wave (the last unit of it dies or leaks) pays
  a flat `20` plus `5 * waveNumber`.
- **Interest.** At the start of each build phase between waves, you earn
  `8%` of your current money as interest, rounded down and capped at
  `+40` per build phase — a gentle reward for not over-spending, so banking to
  upgrade later is a real option. (Some modes disable interest; `specs/modes.md`.)
- **Early-send bonus.** Sending the next wave early (`specs/controls.md`) pays a
  bonus of `1` per whole second left on the build-phase timer when you send
  it, rewarding an aggressive player who is ready before the timer.
- You spend money to **build** and **upgrade** towers and recover `70%` of a
  tower's total spend by **selling** it — or its **full** spend if you sell it
  during the same build phase you placed it on, before that wave starts, so a
  tower that never fought is fully refundable (`specs/towers.md`). You can never
  spend below `0`.

## Lives and Leaks

- You start with `20` lives.
- When a surge unit reaches an **exhaust** (`specs/playfield.md`) it **leaks**,
  costing its leak value in lives (`specs/creeps.md`: most units are worth `1`,
  a Hulk is worth `2`, and a Core is worth `5`) and is removed.
- Lives never regenerate. If lives reach `0` or below, the reactor breaches
  and the game ends (Game over, below) — even mid-wave.

## Waves and Victory

- A game is a run of **`N` waves** on the one floor, where `N` is set by the
  selected mode and difficulty (`specs/modes.md`); the standard **Medium** run is
  `20`. Waves are numbered `WAVE 1` … `WAVE N`.
- Between waves there is a **build phase** of up to `15 s` (its countdown
  shown in the build panel), during which the surge is not spawning and you
  build, upgrade, sell, and re-shape the maze. Interest is paid at its start.
  You may choose to send the next wave early (`specs/controls.md`) for the
  early-send bonus, or let the timer expire to start it automatically.
- **The opening build phase — before Wave 1 — is untimed.** It shows **no
  countdown** and never starts on its own: the player lays their opening maze at
  leisure and presses **Start** (the same wave control, `specs/controls.md`) to
  begin Wave 1 when they are ready. Because there is no timer, the opening phase
  pays no early-send bonus, and interest (paid only at the start of the
  between-wave build phases) does not apply to it. Because nothing has fought yet,
  every tower placed in the opening phase is **fully refundable** while it lasts
  (`specs/towers.md`) — the whole opening layout can be re-shaped without penalty.
  Only the phases *between* waves carry the `15 s` countdown and auto-start.
- During a wave, the surge spawns from the vents over time (the exact
  timing and vent split are specified in `specs/creeps.md`). A wave is **cleared** when
  every unit it released has either died or leaked. Clearing a wave pays its
  bonus and begins the next build phase.
- **Milestone waves.** The **final wave** (Wave `N`) always includes a **Core**
  boss (`specs/creeps.md`) amid the surge, and one earlier **milestone wave** near
  the midpoint of the run (`round(N / 2)`) does too. In the standard `20`-wave
  Medium run these are Wave 10 and Wave 20.
- **Difficulty scaling.** Surge HP scales with the wave number `w`: a unit's
  HP is its base HP (`specs/creeps.md`) times `1 + 0.20 * (w - 1)` (so a Medium
  Wave 20 unit has about `4.8x` its base HP, and a longer run climbs higher).
  Counts grow substantially across the run — waves are large and dense so the
  player's many-tower maze is always pressed (`specs/creeps.md`). Speeds,
  bounties, and leak values do not scale. All other systems (heat, coupling, the
  towers) are unchanged across waves.
- **Victory.** Surviving the **final wave** (Wave `N`) — clearing it with at
  least one life left — **wins** the game (the Victory state, below). A special
  mode may define its own win condition (`specs/modes.md`: The Hundred is won by
  clearing its whole `100`-unit onslaught).

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
   and a vertical menu of two entries: **PLAY**, then **HOW TO PLAY**. The
   selected item is highlighted. A dim slice of reactor floor with a few glowing
   towers may show behind the menu for atmosphere.
2. **Mode select.** Reached from **PLAY**. Lists the selectable modes
   (`specs/modes.md`): the standard **Containment** mode and the special modes.
   Mousing over (or focusing) a mode shows that mode's description — what it is
   and how it changes the game — **before** it is chosen, so the player can read
   a mode before committing to it. Selecting **Containment** goes to
   **Difficulty select**; selecting a special mode starts it. A control returns to
   the main menu.
3. **Difficulty select.** Reached by selecting **Containment** on mode select.
   Lists the three difficulties — **Easy**, **Medium**, **Hard**
   (`specs/modes.md`) — showing what each changes (its starting money and wave
   count) before it is chosen; selecting one starts a Containment game at that
   difficulty. A control returns to mode select.
4. **How to play.** Describes the goal (stop the surge from reaching the
   exhausts), the controls, heat as power and the redline trip, the Forge
   and Sink, the heat-averse Rime, flyers, air-capable emitters, air-only Flak,
   and the economy. Returns to the main menu.
5. **In match.** The live game: the floor and its maze, the surge walking and
   flying, the towers firing and heating, and the build panel. This covers both
   the **build phase** (countdown running, no surge spawning) and the **wave
   phase** (surge active); building is allowed in both (`specs/controls.md`).
6. **Paused.** Reachable in match. Offers **Resume**, **Restart**, and **Quit to
   menu**. The floor is visible but frozen behind the pause menu.
7. **Victory.** Shown when the final wave is cleared with lives remaining.
   Displays the final **score**, **waves survived** (all `N`), and **lives
   remaining**, with **PLAY AGAIN** and **MENU**.
8. **Game over.** Shown when lives reach `0`. Displays the final **score** and
   the **wave reached**, with **PLAY AGAIN** and **MENU**.

## Required menus

Every menu and screen below must be present and reachable. Each entry states its
**content** (what must appear) and its **navigation** (where its choices lead)
only — the visual layout, styling, and interaction details are yours, subject to
the palette and type of `specs/overview.md`. The mode/difficulty content lives in
`specs/modes.md`.

- **Main menu** — the title, the tagline, and the entries **PLAY** and
  **HOW TO PLAY**. PLAY → mode select; HOW TO PLAY → the how-to-play screen.
- **Mode select** — an entry for the standard **Containment** mode and one for
  each special mode, plus a way back to the main menu. Each mode's description
  must be readable **before** it is selected (for example on hover or focus).
  Containment → difficulty select; a special mode → starts that mode; back →
  main menu.
- **Difficulty select** — an entry for **Easy**, **Medium**, and **Hard**, each
  showing its starting money and wave count before selection, plus a way back to
  mode select. A difficulty → starts Containment at it; back → mode select.
- **How to play** — the goal, the controls, and the signature systems; a way back
  to the main menu.
- **Pause menu** — **Resume**, **Restart**, and **Quit to menu**, over the frozen
  floor.
- **Victory screen** and **Game over screen** — the end-of-game results with
  **PLAY AGAIN** and **MENU**. PLAY AGAIN replays the **same mode and
  difficulty**; MENU returns to the main menu.

Every menu must be fully operable with the mouse alone, with the keyboard
accelerators of `specs/controls.md` as an alternative. This specification fixes
the **content and navigation** of these menus, not their layout or presentation.

## HUD

The HUD lives in the build panel (`specs/playfield.md`): **money**, **lives**,
and the **wave indicator** (`WAVE n / N` — the current wave over the run's total,
`specs/modes.md` — with a read of the current wave's progress or the build-phase
countdown; a mode with a single onslaught reads that instead) as status
readouts; the **shop**; the
**selected-tower inspector** with the selected tower's live **heat read**; and
the **wave controls** (send next wave with its bonus, the `1x`/`2x` speed
toggle, and pause). The build panel must always be fully visible
(`specs/overview.md`). On the floor, towers carry their own at-a-glance **heat
read** (`specs/overview.md`, `specs/heat.md`) and surge units carry health bars
(`specs/creeps.md`).

A **next-wave preview** — what types the coming wave contains — should be shown
during the build phase (in the panel or as a banner) so the player can re-shape
the maze for it.

## Key Behaviors

The game must exhibit these behaviors. They are observable and make good test
targets:

- **Towers are walls and you build the maze:** the surge pathfinds the shortest
  open route from each vent to its **opposite exhaust** (left to right, top to
  bottom), re-paths live when a tower is built or sold, and a placement that
  would seal either required route is **refused** (`specs/playfield.md`).
- **Heat is power:** an emitter's damage climbs with its heat to full power at its
  per-tower **redline** and holds it to the `100` **trip**, where it goes offline
  for `5 s`; a tower sheds heat only through faces on open air, so a boxed-in core
  bakes and trips (`specs/heat.md`).
- The thermostatic **Forge** warms touching emitters toward its setpoint (never
  past it) and the coolant **Sink** draws heat out (the only way to cool a boxed-in
  tower), both across shared footprint faces; touching emitters also **conduct**
  heat between themselves (`specs/heat.md`).
- The **Rime** is **heat-averse** — it slows hardest when cold and degrades as
  it heats (`specs/towers.md`).
- **Flyers ignore the maze**; every emitter can hit them in range, while
  **Flak** is air-only and provides dedicated flyer coverage
  (`specs/creeps.md`, `specs/towers.md`).
- The six emitters behave per their stances; towers can be **upgraded**
  (stronger and hotter) and **sold** (`specs/towers.md`); the **economy** runs
  on bounties, the wave bonus, interest, and the early-send bonus.
- A leaked unit **costs lives**; `0` lives ends the game; clearing the final
  wave (or a special mode's win condition, `specs/modes.md`) wins it.

## Out of scope

- Network or online multiplayer, and any saved/persisted progress between
  sessions.
- Touch or gamepad input (mouse and keyboard only for this version).
- A map editor, multiple maps, or procedurally generated floors — this version
  is the one fixed floor of `specs/playfield.md`.
- An in-run research/tech tree beyond the per-tower upgrades of
  `specs/towers.md`.
