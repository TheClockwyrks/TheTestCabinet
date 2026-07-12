# Valence — Economy, integrity, rounds, states, and HUD

This file defines the economy, integrity, the round progression and victory, scoring, the
game's state machine, the HUD's meaning, the behaviors that make good test targets, and
what is out of scope. It refers to the board (`specs/board.md`), the matter
(`specs/matter.md`), the towers (`specs/towers.md`), the controls (`specs/controls.md`),
and the campaign start in `specs/mode.md`.

The numeric values here are **fixed**; implement them exactly as written, except the
**starting energy and integrity**, which `specs/mode.md` sets per campaign start.

## Energy and the economy

**Energy** is the currency — released when matter is broken down and spent to build and
upgrade towers, so the matter always presses against a board that is still being built up.

- **Starting energy** is set by the campaign start (`specs/mode.md`).
- **Neutralize bounty.** Neutralizing a unit pays its **energy** value (`specs/matter.md`)
  the moment it is removed — a stripped-out atom, a fissioned heavy's daughters as they are
  neutralized, and so on. Fragments each pay their own value as they are finished.
- **Round-clear bonus.** Clearing a round (its last unit dies or leaks) pays a flat `20`
  plus `5 × roundNumber`.
- **Interest.** At the start of each between-round build phase you earn `5%` of your
  current energy as interest, rounded down and **capped at `+50`** per build phase — a
  gentle reward for banking rather than over-spending. (A campaign start may disable
  interest; `specs/mode.md`.)
- **Early-send bonus.** Sending the next round early (`specs/controls.md`) pays `1` energy
  per whole second left on the build-phase countdown when you send it.
- You spend energy to **build** and **upgrade** towers and recover a refund by **selling**
  (`specs/towers.md`). Energy never goes below `0`.

## Integrity and leaks

- You start with the **integrity** set by the campaign start (`specs/mode.md`).
- When a unit reaches the **collector** (`specs/board.md`) it **leaks**, costing its **leak**
  value in integrity (`specs/matter.md`: most units `1`, a Polymer or Heavy `2`, the boss
  `12`) and is removed. Because matter fragments, a partly-broken unit still leaks its
  pieces — an unopened molecule or unsplit heavy that slips through costs its whole leak.
- Integrity never regenerates. If integrity reaches **`0` or below**, containment fails and
  the game ends (Containment failed, below) — even mid-round.

## Rounds and victory

- A game is a run of **`20` rounds** on the one board, numbered `ROUND 1` … `ROUND 20`.
- Between rounds there is a **build phase** of up to **`15 s`** (its countdown shown in the
  build panel, `specs/board.md`), during which no matter spawns and you build, upgrade,
  sell, and re-shape the board. Interest is paid at its start. You may **send the next round
  early** (`specs/controls.md`) for the early-send bonus, or let the timer expire to start
  it automatically.
- **The opening build phase — before Round 1 — is untimed.** It shows **no countdown** and
  never starts on its own: the player lays their opening board at leisure and presses
  **START ROUND** when ready. It pays no early-send bonus, and interest (paid only at the
  start of the between-round phases) does not apply to it. Because nothing has faced a round
  yet, every tower placed in the opening phase is **fully refundable** while it lasts
  (`specs/towers.md`).
- During a round, matter spawns from the inlet over time and across both lanes
  (`specs/board.md`, `specs/matter.md`). A round is **cleared** when every unit it released
  has either been neutralized or leaked. Clearing a round pays its bonus and begins the next
  build phase.
- **Milestone rounds.** The **final round** (Round 20) always includes a **Macromass** boss
  (`specs/matter.md`) amid the wave, and one earlier milestone round at the midpoint
  (**Round 10**) does too.
- **Difficulty scaling.** Matter grows harder with the round number `r`:
  - **Counts** grow substantially across the run — rounds get larger and denser so the
    player's board is always pressed.
  - **Free atoms** gain shells: a type's electron shells are its base
    (`specs/matter.md`) `+ floor((r − 1) / 5)` (so a Monatom is `2` shells at Round 1 and
    `5` by Round 20).
  - **Molecules** gain length: add one atom (and one bond) every `6` rounds, so a Dimer and
    Polymer are longer, and messier to shear, late.
  - **Heavies** gain criticality: base `+ floor((r − 1) / 6)` fission hits to split.
  - The **boss's** criticality and fragment count grow with the milestone round it anchors.
  - Speeds, energy bounties, and leak values **do not** scale with the round. All towers are
    unchanged across rounds; only the matter grows.
- **Victory.** Clearing the **final round** (Round 20) with **integrity remaining** wins the
  game (the Victory state, below).

## Scoring

A **score** accumulates across the run and shows in the HUD and end screens:

- `+ energy value` for each unit neutralized (the same value the bounty pays).
- `+ 100 × roundNumber` for each round cleared.
- `+ 250 × integrityRemaining` awarded at Victory.

Score is for the end-screen result and bragging rights only; it does not affect play and is
**not persisted** between sessions.

## Game states

The game is a small state machine. Each state has a clear screen and controls (controls are
defined in `specs/controls.md`).

1. **Title / main menu.** Shows the title `VALENCE`, a tagline, and a vertical menu listing
   the playable start defined by `specs/mode.md` (which declares its own entry),
   followed by `HOW TO PLAY`. The selected item is highlighted. A dim slice of a live
   board may show behind the menu for atmosphere.
2. **How to play.** Describes the goal (break matter down before it reaches the collector),
   the controls, the four matter forms and the tool each needs (shear molecules, ionize
   atoms, fission heavies, catalyze inert matter), the Moderator's slow, and the economy and
   integrity. Returns to the menu.
3. **In play.** The live game: the board and its conduit, matter flowing both lanes, the
   towers firing and the support auras, and the full HUD and build panel. This covers both
   the **build phase** (countdown running, no matter spawning) and the **round phase**
   (matter active); building is allowed in both (`specs/controls.md`).
4. **Paused.** The `Esc` overlay menu, reachable in play. Offers **Resume**, **Restart**,
   and **Quit to menu**. The board is visible but frozen behind the menu.
5. **Victory.** Shown when the final round is cleared with integrity remaining. Displays the
   final **score**, **rounds survived** (all `20`), and **integrity remaining**, with
   **PLAY AGAIN** and **MENU**.
6. **Containment failed.** Shown when integrity reaches `0`. Displays the final
   **score** and the **round reached**, with **PLAY AGAIN** (or **TRY AGAIN**) and **MENU**.

## Required menus

Every menu and screen below must be present and reachable. Each entry states its **content**
(what must appear) and its **navigation** (where its choices lead); the visual layout,
styling, and interaction details are yours, subject to the palette and type of
`specs/overview.md`. The campaign start's menu entry is in `specs/mode.md`.

- **Main menu** — the title, a tagline, the playable start from `specs/mode.md`, then
  **HOW TO PLAY**. The start → begins a game; HOW TO PLAY → the how-to-play screen.
- **How to play** — the goal, the controls, the four forms and their tools, and the economy;
  a way back to the main menu.
- **Pause menu** — **Resume**, **Restart**, and **Quit to menu**, over the frozen board.
- **Victory screen** and **Containment-failed screen** — the end-of-game results with
  **PLAY AGAIN** and **MENU**. PLAY AGAIN replays the same campaign start; MENU returns to
  the main menu.

Every menu must be fully operable with the mouse alone, with the keyboard accelerators of
`specs/controls.md` as an alternative. This specification fixes the **content and
navigation** of these menus, not their layout or presentation.

## HUD

The HUD is the top status bar and the right build panel (`specs/board.md`), drawn in code
(`specs/assets.md`; only their small icons may be produced sprites), always fully visible:

- **Status bar** (`y` in `[0, 56]`): **energy**, **integrity** (turning to the alert color
  as it runs low), the **round indicator** `ROUND n / 20` with the current round's progress
  or the build-phase countdown, and the **speed**, **pause**, and **mute** controls.
- **Build panel** (`x` in `[1000, 1280]`): the **shop** (each tower's name, cost, icon, and
  on hover its info), the **selected-tower inspector** (level, live stats, upgrade and sell),
  the **next-round preview** (the coming round's types, shown when nothing is selected or
  hovered), and the **START ROUND / send-early** control with the speed toggle.

On the board, each unit carries its form's **integrity read** (an atom's shells, a
molecule's bonds, a heavy's criticality — `specs/matter.md`) and each tower reads as its
type and shows its **range** when selected or held. A player must be able to read, without
hunting, whether they can afford the next tower, how close integrity is to zero, what the
coming round needs, and which unit on the board needs which tool.

## Key behaviors

The game must exhibit these behaviors. They are observable and make good test targets:

- Matter enters at the **inlet**, is split across the two **lanes** at the splitter, and
  leaks at the **collector**; both lanes carry traffic and both must be defended
  (`specs/board.md`).
- Towers build **on the board's grid cells** (not on conduit-blocked cells), cover the
  conduit within their **range**, and fire **automatically** at the valid in-range unit
  furthest along (`specs/board.md`,
  `specs/towers.md`).
- **Shear** peels a molecule into free atoms, **Ionizer** strips a free atom's shells to
  neutralize it, and **Fission** is the only thing that splits a **heavy** into daughter
  atoms — each acting on one form and nothing else (`specs/matter.md`, `specs/towers.md`).
- **Inert** matter is untargetable until a **Catalyst** makes it reactive; a **Moderator**
  slows matter (heavies resist, the boss is immune) — support that changes what the damage
  towers can reach (`specs/matter.md`, `specs/towers.md`).
- **Fragments continue** on their lane: a partly-sheared molecule or unsplit heavy still
  sends its pieces onward, and an unopened form leaks (`specs/matter.md`).
- The **economy** runs on neutralize bounties, the round-clear bonus, interest, and the
  early-send bonus; a **leak** costs integrity; **`0`** integrity fails containment; clearing
  the **final round** with integrity left wins (this file).
- Towers can be **upgraded** (stronger per `specs/towers.md`) and **sold**; the milestone
  rounds field a **Macromass** boss that **fragments as it is fissioned** (`specs/matter.md`).
- The matter and tower sprites, the electron and boss **animations**, the decomposition
  **particle bursts**, and the **audio** are all **produced with the on-`PATH` tools** and
  wired in (`specs/assets.md`).

## Out of scope

- Network or online multiplayer, and any saved/persisted progress between sessions.
- Touch or gamepad input (mouse and keyboard only for this version).
- A board editor, multiple boards, or procedurally generated conduits — this version is the
  one fixed board of `specs/board.md`.
- An in-run research or tech tree beyond the per-tower upgrades of `specs/towers.md`.
- Any matter form, tower, or mechanic beyond those specified here — keep the scope to the
  systems above, done well.
