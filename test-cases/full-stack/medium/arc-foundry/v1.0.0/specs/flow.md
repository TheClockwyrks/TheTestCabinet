# Flow — economy, integrity, the campaign, states, and HUD

This file defines the economy (Charge), Grid Integrity and leaks, the wave
campaign and victory/overload, scoring, the game's state machine, the required
menus, the HUD's meaning, the behaviors that make good test targets, and what is
out of scope. It refers to the yard and its regions (`specs/board.md`), the Load
(`specs/enemies.md`), the components (`specs/towers.md`), the scrap-press build
loop (`specs/build.md`), the controls (`specs/controls.md`), and the difficulty
and map menus (`specs/modes.md`).

The numeric values here are **fixed**; implement them exactly as written, except
the **wave count** and the **enemy HP scaling**, which `specs/modes.md` sets per
difficulty. Every value in this file is **constant across difficulty** — only the
wave count and enemy toughness change.

## Charge and the economy

**Charge** is the currency — scavenged power spent to place rocks at the scrap-press
and to UPGRADE QUALITY, and recovered from kill bounties, the wave-clear bonus, and
interest, so the Load always presses against a maze that is still being built up.

- **Starting Charge** is `130` — enough to open with a few stamps and a starter
  maze, not a full board.
- **Kill bounty.** Killing a Load unit pays its **bounty** (`specs/enemies.md`)
  the moment it is removed.
- **Wave-clear bonus.** Clearing a wave (its last unit dies or leaks) pays a flat
  `20` plus `5 × waveNumber`.
- **Interest.** At the start of each **between-wave build phase** you earn `8%` of
  your current Charge, rounded down and **capped at `+40`** per build phase — a
  gentle reward for banking rather than over-spending. (The opening phase before
  Wave 1 earns no interest.)
- **Spending.** Charge is spent on two things: **placing rocks** and **UPGRADE
  QUALITY**. Placing a rock costs `10` Charge and rolls one component where it lands,
  up to the `5`-per-level allowance (`specs/build.md`); Charge never goes below `0`,
  so the press is disabled when you cannot afford `10`. **UPGRADE QUALITY** buys the
  next Refinement level for its fixed cost (`60 / 130 / 240 / 400 / 620` up the R1–R5
  track, `specs/build.md`). **Combining costs nothing.** There is **no selling** — nothing
  you place is ever refunded for Charge, so the only Charge sinks are stamps and
  refinement. You may **dismantle** a misplaced structure between waves as a correction,
  but it **returns nothing** — no Charge and no stamp, ever (a refund would let you re-roll
  the press for free, `specs/towers.md`).

## Grid Integrity and leaks

- You start with `20` **Grid Integrity**.
- When a Load unit reaches the **Collector** (`specs/board.md`) it **grounds out
  (leaks)**, costing its **leak** value in integrity (`specs/enemies.md`: most
  units `1`, a Slug `2`, and the Dynamo boss `5`) and is removed, with a
  **leak-alarm** VFX and sound (`specs/assets.md`).
- Integrity never regenerates. If integrity reaches **`0` or below**, the grid
  overloads and the game ends (Overload, below) — even mid-wave.

## The wave campaign and victory

- A run is a fixed sequence of **`N` waves** on the **map the player chose** at the
  map-select screen (`specs/board.md`), where `N` is set by the selected difficulty
  (`specs/modes.md`); the reference **Medium** run is `50`. Waves are numbered
  `WAVE 1` … `WAVE N`.
- Between waves there is an **untimed build phase**, during which the Load is not
  spawning and you place rocks, keep, combine, and upgrade quality (`specs/build.md`).
  It shows **no countdown** and never starts on its own; interest is paid at its
  start. The player re-shapes the maze at leisure and presses **SEND** (the wave
  control, `specs/controls.md`) to resolve the level — the level's single **harvest**
  lands (a **KEEP** of one rolled candidate, a **quality-combine** a tier up the
  ladder, or a **combination-tower recipe**, `specs/build.md`, `specs/towers.md`) and
  every other rock hardens into a blocker — and start the next wave.
- **The opening build phase — before Wave 1 — is also untimed**, reads **START**
  instead of SEND, and pays no interest (interest is paid only at the start of the
  between-wave phases). The `130` opening Charge lays the first partial maze, not a
  finished board.
- Building is allowed **only during the build phase**, never during a live wave,
  subject to the fixed allowance of **`5` rock stamps per level** (`specs/build.md`).
  There is no build-phase timer and no early-send bonus.
- During a wave, the Load spawns from the map's **Entry** over time (the exact
  timing and per-wave mix are specified in `specs/enemies.md`). A wave is
  **cleared** when every unit it released has either died or leaked. Clearing a
  wave pays its bonus and opens the next build phase.
- **Milestone waves.** A **Dynamo** boss (`specs/enemies.md`) anchors two waves:
  the **final wave** (Wave `N`) always, and one **midpoint** wave (`round(N / 2)`)
  always. In the reference `50`-wave Medium run these are Wave `25` and Wave `50`.
- **Difficulty scaling.** Only the **wave count** `N` and the **enemy HP scaling**
  change with difficulty (`specs/modes.md`). A unit's HP on wave `w` is its base HP
  (`specs/enemies.md`) times `baseMult × (1 + k × (w − 1))`, where `baseMult` and
  `k` are the difficulty's constants (Medium `baseMult = 0.22`, `k = 1.17`). Speeds,
  bounties, and leak values do not scale, and every component stat is unchanged
  across waves — only the Load grows.
- **Victory.** Clearing the **final wave** (Wave `N`) with **Grid Integrity
  remaining** wins the game (the Victory state, below).
- **Overload (defeat).** Grid Integrity reaching `0` ends the game (the Overload
  state, below), even mid-wave.

## Scoring

A **score** accumulates across the run and shows in the HUD and end screens:

- `+ bounty` for each unit killed (the same value the Charge bounty pays).
- `+ 100 × waveNumber` for each wave cleared.
- `+ 250 × integrityRemaining` awarded at Victory.

Score is for the end-screen result and bragging rights only; it does not affect
play and is **not persisted** between sessions.

## Game states

The game is a small state machine. Each state has a clear screen and controls
(controls are defined in `specs/controls.md`).

1. **Title / main menu.** Shows the title `ARC FOUNDRY`, a tagline, and a vertical
   menu listing the playable start defined by `specs/mode.md` (which declares its
   own entry, `SALVAGE`), followed by `HOW TO PLAY`. The selected item is
   highlighted. A dim slice of a live yard may show behind the menu for atmosphere.
2. **Map select.** Reached from the campaign start on the main menu
   (`specs/mode.md`). Lists the three **maps** (`specs/board.md`) — "The
   Substation", "The Switchyard", and "The Transformer Yard" — each showing its
   **name** and a small preview of its **waypoint layout** (and Map C's fixed
   housings) so the player can read the maze it poses before choosing. Choosing a
   map advances to **Difficulty select**; a **BACK** choice returns to the main
   menu.
3. **Difficulty select.** Reached from map select. Lists the three difficulties —
   **Easy**, **Medium**, **Hard** (`specs/modes.md`) — each showing what it changes
   (its **wave count** and its **enemy toughness**) before it is chosen. Selecting
   one begins the campaign on the chosen map at that difficulty; a **BACK** choice
   returns to map select.
4. **How to play.** Describes the goal (stop the Load from reaching the Collector),
   the controls, the scrap-press build (place a rock that **rolls a random component
   on placement**), the **keep exactly one per level** rule and that every other rock
   hardens into an inert **blocker**, **combining** a match up the quality ladder,
   **UPGRADE QUALITY** (refining the press for better rolls), that every rock and
   component is also a **wall** and you build the maze, the ordered waypoints and
   their platforms, the flyer that appears every four waves and ignores the maze, and
   the economy and Grid Integrity. Returns to the main menu.
5. **In match.** The live game: the chosen map's yard and its maze, the Load walking
   and flying, the components firing, and the build panel. This covers both the
   **untimed build phase** (no Load spawning; you build) and the **wave phase** (Load
   active; building is disabled, `specs/controls.md`). Play can be **paused in place**
   here — ticks freeze while the board stays visible, with no menu over it and a clear
   `PAUSED` read — via the status-bar pause control or the pause hotkey
   (`specs/controls.md`).
6. **Paused.** The `Esc` overlay menu, reachable in match. Offers **Resume**,
   **Restart**, and **Quit to menu**. The yard is visible but frozen behind the
   menu. This is separate from the in-place pause of state 5: the menu freezes the
   game *and* covers it, whereas the in-place pause freezes the game but keeps it
   playable.
7. **Victory.** Shown when the final wave is cleared with Grid Integrity remaining.
   Displays the final **score**, **waves survived** (all `N`), and **Grid Integrity
   remaining**, with **PLAY AGAIN** and **MENU**.
8. **Overload.** Shown when Grid Integrity reaches `0`. Displays the final
   **score** and the **wave reached**, with **PLAY AGAIN** (or **TRY AGAIN**) and
   **MENU**.

## Required menus

Every menu and screen below must be present and reachable. Each entry states its
**content** (what must appear) and its **navigation** (where its choices lead); the
visual layout, styling, and interaction details are yours, subject to the palette
and type of `specs/overview.md`. The campaign start's menu entry is in
`specs/mode.md`; the map and difficulty content is in `specs/modes.md` and
`specs/board.md`.

- **Main menu** — the title, a tagline, the playable start from `specs/mode.md`
  (`SALVAGE`), then **HOW TO PLAY**. The start → map select; HOW TO PLAY → the
  how-to-play screen.
- **Map select** — an entry for each of the three maps, each with its name and a
  preview of its waypoint layout (`specs/board.md`); choosing one → difficulty
  select; **BACK** → the main menu.
- **Difficulty select** — an entry for **Easy**, **Medium**, and **Hard**, each
  showing its **wave count** and **enemy toughness** before selection
  (`specs/modes.md`); choosing one → begins the campaign on the chosen map at that
  difficulty; **BACK** → map select.
- **How to play** — the goal, the controls, the scrap-press build and the three
  fates, the maze-and-waypoints model, and the economy; a way back to the main
  menu.
- **Pause menu** — **Resume**, **Restart**, and **Quit to menu**, over the frozen
  yard.
- **Victory screen** and **Overload screen** — the end-of-game results with **PLAY
  AGAIN** and **MENU**. PLAY AGAIN replays the campaign on the **same map and
  difficulty**; MENU returns to the main menu.

Every menu must be fully operable with the mouse alone, with the keyboard
accelerators of `specs/controls.md` as an alternative. This specification fixes the
**content and navigation** of these menus, not their layout or presentation.

## HUD

The HUD is the top status bar and the right build panel (`specs/board.md`), drawn
in code (`specs/assets.md`; only their small icons may be produced sprites), always
fully visible:

- **Status bar** (`y` in `[0, 56]`): **Charge**, **Grid Integrity** (turning to the
  alert color as it runs low), the **wave indicator** `WAVE n / N` with the current
  wave's progress or a **BUILD** read between waves (the phase is untimed), and the
  **speed**, **pause**, and **mute** controls. A clear `PAUSED` read shows while paused
  in place.
- **Build panel** (`x` in `[1000, 1280]`): the **scrap-press** control (STAMP, showing
  its `10` cost and the remaining stamps of the `5`-per-level allowance); the **UPGRADE
  QUALITY** control (the current Refinement level `R` and the next level's cost,
  `specs/build.md`); the **selected candidate/component inspector** (its type, quality
  tier, live stats — damage, range, fire rate, targeting; a **combination tower**
  instead reads its recipe and abilities, and a **Regulator** reads an **aura**
  radius/bonus readout since it does not fire, `specs/towers.md`) and the **KEEP /
  COMBINE** and **targeting** controls, with KEEP/COMBINE on candidates during the
  build phase and COMBINE shown only when a match exists (a quality match **or** a
  combination-tower recipe), `specs/build.md`); the **next-wave preview**
  (the coming wave's types, shown when nothing is selected); and the **wave control**
  (START / SEND) with the speed toggle.

On the board, each unit carries a **health bar** (`specs/enemies.md`), each component
and candidate reads as its **type** and **quality tier** (its finish and VFX escalate
by tier, `specs/towers.md`), a **blocker** reads as an inert rock, and a selected or
held piece shows its **range ring**. A player must be able to read, without hunting,
how much Charge they have, how close Grid Integrity is to zero, which wave is coming and
what it contains, and
each board component's type and quality — at fast speed.

## Key behaviors

The game must exhibit these behaviors. They are observable and make good test
targets:

- The campaign begins at **MAP SELECT** where the player picks one of three maps,
  then a **DIFFICULTY SELECT** where they pick Easy / Medium / Hard, and plays the
  run on that map at that difficulty (`specs/board.md`, `specs/modes.md`).
- **Difficulty changes only wave count and enemy toughness.** Starting Charge
  (`130`), Grid Integrity (`20`), builds-per-level (`5`), stamp cost (`10`), the
  Refinement track, the roster, and every economy value are identical on Easy /
  Medium / Hard (`specs/modes.md`).
- Every rock and component is also a **wall** and you **build the maze**: the Load
  traverses its map's ordered waypoints (each a 4-tile **platform**), taking the
  shortest **open** route between consecutive waypoints, and building lengthens the
  route; a placement that would seal any segment, or land on a waypoint platform, is
  **refused**, and the floor **re-paths live** as walls change (`specs/board.md`).
- The **scrap-press** places a rock that **rolls a random component type at a random
  quality on placement** (biased upward by Refinement); you **keep exactly one** roll
  per level as a firing component, every other rock hardens into an inert **blocker**,
  and **combining** — either a quality match (same type + quality → one tier higher)
  or a **combination-tower recipe** — is the level's alternative harvest
  (`specs/build.md`, `specs/towers.md`).
- Components **fire automatically** at valid in-range units with selectable targeting,
  throwing visible traveling arcs that carry the hit — the **Regulator** is the one
  exception, a **non-firing** support type that projects a buff aura instead
  (`specs/towers.md`); **flyers** (every fourth wave) ignore the maze but can still be
  hit in range (`specs/towers.md`, `specs/enemies.md`).
- The **economy** runs on kill bounties, the wave-clear bonus, and interest, spent on
  stamps and **UPGRADE QUALITY** (no selling); a **leak** costs Grid Integrity; **`0`**
  integrity overloads and ends the game; clearing the **final wave** with integrity left
  wins it (this file).
- A **Dynamo** boss anchors the milestone waves (`round(N / 2)` and Wave `N`), seething
  and bursting into a big discharge on death (`specs/enemies.md`, `specs/assets.md`).
- The game can be **paused in place** (status-bar pause or the pause hotkey during a
  wave): ticks freeze so you can read the frozen board, with no menu shown. **`Esc`**
  instead opens the pause **menu**, which also freezes the game (`specs/controls.md`).
- The component and Load sprites, the enemy and boss **animations**, the
  **electrical particle VFX** (arcs, chain-lightning, spark showers, discharges),
  and the **audio** are all **produced with the on-`PATH` tools** and wired in
  (`specs/assets.md`).

## Out of scope

- Network or online multiplayer, and any saved/persisted progress between sessions.
- Touch or gamepad input (mouse and keyboard only for this version).
- A map editor or **procedurally generated** yards — the maps are the **fixed,
  hand-authored set** of `specs/board.md` (the player chooses among the three at map
  select, but cannot edit or generate one).
- An in-run research or tech tree beyond the quality-ladder climb of
  `specs/build.md` and the per-component targeting of `specs/towers.md`.
- Any Load form, component type, quality tier, or mechanic beyond those specified
  here — keep the scope to the systems above, done well.
