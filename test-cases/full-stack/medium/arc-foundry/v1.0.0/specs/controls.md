# Arc Foundry — Controls

This file defines how the player interacts with the yard: the simulation step,
pulling the scrap-press and placing rocks, selecting and inspecting a candidate or
component, the **keep / combine / upgrade-quality / targeting** controls, driving the
waves, and the speed and pause controls. It builds on the tile grid, the waypoint
zones, and the build-panel layout in `specs/board.md`, the components in
`specs/towers.md`, the build loop in `specs/build.md`, and the flow in `specs/flow.md`.
Mouse and keyboard only; no touch or gamepad for this version, and **every interaction
and menu must be achievable with the mouse alone**, with the keyboard shortcuts as
accelerators.

## Simulation

Run the simulation on a **fixed timestep** — the **tick** (for example 60 Hz) —
decoupled from rendering, so unit movement, live re-pathing, component fire,
projectiles, and the economy are reproducible and independent of the render frame rate.
Render with smooth interpolation between ticks. The **speed control** (below) scales how
many ticks pass per real second; it must change only how fast the game plays, never the
*outcome*. **Pause** halts ticks entirely, and comes in two forms that both freeze ticks
but differ in what else they do — an **in-place pause** and the **pause menu**, both
described under *Waves, speed, and pause* below.

## Building happens only in the build phase

All building — pulling the press, placing rocks, keeping, combining, and upgrading
quality — happens **only during a build phase** (`specs/flow.md`), never during a live
wave. While a wave is running the build controls are disabled; you may still **select a
component** to read its stats and **change its targeting**, but you cannot stamp, keep,
combine, or upgrade until the wave clears and the next build phase opens.

## Stamping and placing a rock (the scrap-press)

The player builds only by **pulling the scrap-press**, which puts a blank rock on the
cursor to drop on the grid; **the component is rolled where the rock lands, not when you
pull** (`specs/build.md`):

1. **Pull the press.** Click the **STAMP** control in the build panel
   (`specs/board.md`), or press its hotkey **`B`**, to arm a **blank rock** on the
   cursor. STAMP is refused (clearly) when the **5-stamp allowance** is spent or you
   cannot afford **10 Charge** — the allowance is a hard cap of five per level and is
   **not** a function of Charge (`specs/build.md`).
2. **Position.** The blank rock is **held on the cursor** as its uniform **`2×2` tile
   footprint** (`specs/board.md`), snapping to the grid under the pointer. The preview
   shows a **legal/illegal** footprint cue (`#46d07a` legal, `#ff4d4d` illegal). A
   footprint is illegal if any of its four tiles is off the board, already blocked by a
   component/blocker or a fixed housing, a **waypoint-zone** tile, or if placing it
   would **seal** any waypoint segment (the **never-seal rule**, `specs/board.md`).
3. **Place.** Left-click a **legal** footprint to drop the rock: it lands, **rolls a
   random component type at a random quality** on the current Refinement odds
   (`specs/build.md`), becomes an **ACTIVE candidate** (walling + inspectable, not yet
   yours), and the floor **re-paths live** (`specs/board.md`). A **build spark** VFX
   fires at the new footprint (`specs/assets.md`).
4. **Continuous placement.** After a drop, if a stamp and Charge remain, the press
   **immediately arms another rock** on the cursor so you place five back-to-back
   without re-clicking STAMP (`specs/build.md`). Placement ends when the allowance or
   Charge is exhausted, or you cancel.
5. **Cancel (free).** Press **`Esc`** or right-click while holding a rock to put it away
   with **no Charge spent and no stamp consumed** (`specs/build.md`).

Dropping a rock **onto an existing blocker** rerolls that blocker into a fresh candidate
(spending a stamp + Charge), the way you turn an old wall into a tower (`specs/build.md`).

## Selecting and inspecting a candidate or component

- **Select.** Left-click a placed candidate, component, or blocker (when not holding a
  rock) to select it. The selection shows its **range ring** on the yard (components and
  candidates only), and the **inspector** in the build panel (`specs/board.md`) shows
  its **type**, **quality tier**, a short **description** of what the component does, live
  stats (damage, range, fire rate, targeting), and its action controls. For a **firing
  component** it also shows a per-component performance tally — its **kills** and **total
  damage dealt** — so the player can read which towers are carrying. A blocker reads as
  inert (no range, no targeting) and offers only a **DISMANTLE** action (below).
- **Keep.** With a **candidate** selected during the build phase, click **KEEP** or
  press **`K`** to mark it as this level's kept roll (`specs/build.md`). Only one
  candidate is ever the kept one; keeping another moves the choice. The keep is
  reversible until you send the wave, when the kept candidate becomes a permanent firing
  component and every other candidate hardens into a blocker.
- **Combine.** **COMBINE** appears in the inspector **only** when the selected
  **candidate** (build phase only) has a matching **candidate or component** of the same
  type and same quality on the board (`specs/build.md`). Clicking it, or pressing
  **`C`**, sets this level's harvest to that combine (the alternative to a plain keep);
  the inspector **previews what it produces** (the component's type at the higher tier).
  It resolves at wave start, producing one component one tier higher at the candidate's
  footprint and consuming the partner — whose footprint **hardens into a blocker** so the
  maze is unchanged — for **no Charge**, with a **combine flash** VFX (`specs/assets.md`).
  A **Tesla-Prime** candidate offers no COMBINE.
- **Upgrade quality.** The build panel's **UPGRADE QUALITY** control — or **`U`** —
  spends Charge to buy the next **Refinement** level, biasing future rolls toward higher
  qualities (`specs/build.md`). It is disabled at **R5** or when you cannot afford the
  next cost.
- **Targeting.** With a **component** selected, the inspector shows a **targeting**
  control that **cycles** its priority — `first` → `last` → `nearest` → `strongest` →
  `weakest` and back — on each click or press of **`T`**. The priority applies to that
  component only, defaults to **`first`** (furthest along the waypoint chain), and takes
  effect immediately (`specs/towers.md`). Targeting may be changed at any time, including
  during a live wave, since it is not a build action.
- **Dismantle.** With a structure selected **during the build phase**, the inspector shows
  a **DISMANTLE** control — or press **`X`** (also `Delete` / `Backspace`) — that removes
  it, clears its footprint, and **re-paths the floor live** (`specs/board.md`). It is a
  misplacement correction, **not a sale**: it returns **nothing** — no Charge and no stamp,
  ever, including for a candidate placed that same phase (a refund would let you re-roll the
  press for free, defeating the RNG, `specs/towers.md`). Dismantling is disabled during a
  live wave.
- **Deselect.** Click empty yard or press **`Esc`** to deselect.

## Waves, speed, and pause

- **Send wave.** The **SEND** control in the build panel (`specs/board.md`) — or
  **`Space`** — resolves the build phase (the kept candidate becomes a component, the
  rest harden into blockers, `specs/build.md`) and starts the next wave. **Every build
  phase is untimed**: it never starts on its own and shows no countdown; the Load waits
  until you press SEND. The opening build phase before Wave 1 reads **START**; between
  waves it reads **SEND**. There is no early-send bonus and no build-phase timer
  (`specs/flow.md`). Once a wave is **live**, **`Space`** instead toggles the **in-place
  pause** (below).
- **Speed.** A **speed** toggle in the panel — or **`F`** — cycles the game speed
  between **`1×`** and **`2×`**, scaling how many ticks pass per second (the current
  speed is shown, `specs/board.md`). It applies to the whole simulation and persists
  until changed.
- **In-place pause.** A dedicated **pause** control in the status bar — and, once a wave
  is live, **`Space`** — **pauses and resumes in place**: it freezes ticks (the Load,
  fire, projectiles, and the economy all halt) **without** opening a menu, so you can
  watch the frozen board and read it, then resume. The frozen state reads clearly as
  **PAUSED** (`specs/board.md`). This is distinct from the pause **menu** below.
- **Pause menu.** **`Esc`** with nothing held or selected opens the **Paused** overlay
  menu — **Resume**, **Restart**, **Quit to menu** (`specs/flow.md`) — which also freezes
  the board behind it; while holding a rock or with something selected, `Esc` first
  cancels/deselects that. **Resume** returns to normal running play, clearing any
  in-place pause.
- **Mute.** **`M`** — or the status-bar control — toggles audio mute (`specs/flow.md`).

## Menu navigation

In the title, map-select, difficulty-select, how-to-play, pause, victory, and overload
screens (`specs/flow.md`, `specs/modes.md`), the pointer and/or `Up`/`Down` (or `W`/`S`)
move the selection and `Enter`/`Space` confirms; `Esc` backs out of a submenu to the
previous screen. The map-select and difficulty-select screens must let the player read
what each choice changes before confirming (`specs/modes.md`). Every menu must be fully
operable with the **mouse alone**, with these keyboard accelerators as an alternative.

## Keyboard shortcuts (accelerators)

The mouse path above is the primary pointing device; the shortcuts below are
**required** alongside it, and a held key must not auto-repeat an action meant to fire
once per press (pulling the press, keeping, combining, upgrading quality, sending a
wave, toggling speed, pausing, cycling targeting):

- **Pull the scrap-press (STAMP):** `B`
- **Keep selected candidate:** `K`
- **Combine selected candidate (when a match exists):** `C`
- **Upgrade quality (Refinement):** `U`
- **Cycle targeting priority (component selected):** `T`
- **Cancel held rock / deselect / back:** `Esc`
- **Send wave; in-place pause once live:** `Space`
- **Speed toggle (`1×`/`2×`):** `F`
- **Mute:** `M`

Whatever exact keys you choose, list them in the in-game **How to play** screen
(`specs/flow.md`) and in the produced `README.md`.
