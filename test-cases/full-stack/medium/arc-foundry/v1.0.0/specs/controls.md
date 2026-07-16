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

## What is build-phase-only, and what is not

Most building — pulling the press, placing rocks, **keeping**, **downgrading**, **upgrading
quality**, **upgrading a combo**, and **dismantling** — happens **only during a
build phase** (`specs/flow.md`). While a wave is running those controls are disabled.

Two things are **not** restricted to the build phase and may be done at any time, including
during a live wave: **changing a component's targeting**, and **combining** (a quality-climb
or a combination-tower recipe). Combining is an immediate action decoupled from the build
loop, so a player can fold towers together mid-wave as the situation demands
(`specs/build.md`).

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

The scrap-press area of the build panel must **always show the current quality-roll
odds** — the probability of each quality tier for the next rock at the live **Refinement**
level (`specs/build.md`) — so the player can read what a placement is likely to roll
**before** committing a stamp, and see how buying **UPGRADE QUALITY** shifts those odds.
Show the same odds while a blank rock is held.

## Selecting and inspecting a candidate or component

- **Select.** Left-click a placed candidate, component, or blocker (when not holding a
  rock) to select it as the **primary** selection. The selection shows its **range ring**
  on the yard (firing components and candidates only), and the **inspector** in the build
  panel (`specs/board.md`) shows its **type** — one of the **eight** base component types
  (Capacitor, Coil, Emitter, Arc-Node, Discharge Rig, Choke, Rectifier, Regulator) or a
  **combination tower** (`specs/towers.md`) — its **quality tier** (base types only; a
  combo shows its **upgrade level** instead), a short **description** of what the component
  does, live stats (damage, range, fire rate, targeting), and its action controls. For a
  **firing component** it also shows a per-component performance tally — its **kills** and
  **total damage dealt**. A **Regulator**, and any other non-firing support piece, shows its
  **aura** (radius and damage bonus) in place of damage/rate and **has no targeting control**
  (below). A blocker reads as inert (no range, no targeting) and offers only a **DISMANTLE**
  action (below).
- **Multi-select (for combining).** **Shift-click** additional base structures (candidates
  or base components) to add them to an explicit **combine set** alongside the primary; the
  set's members pulse on the board. Combining then folds **exactly** that set (a matched
  pair, or a recipe multiset), so a player can choose precisely which duplicate copies to
  merge. A plain (non-shift) click clears the set back to a single selection.
- **Keep.** With a **candidate** selected during the build phase, click **KEEP** or
  press **`K`** to mark it as this level's kept roll (`specs/build.md`). Only one
  candidate is ever the kept one; keeping another moves the choice. The keep is
  reversible until you send the wave, when the kept candidate becomes a permanent firing
  component and every other candidate hardens into a blocker.
- **Combine — two kinds, immediate.** With a **base structure** (a candidate **or** a base
  component) selected, the inspector may offer combine actions. A combine resolves **the
  instant you commit it** — it is **not** the level's harvest, does not consume your keep,
  may be done **any number of times** per level, and is allowed **during a live wave**. Each
  costs **no Charge** and fires a **combine flash** VFX (`specs/assets.md`). The result lands
  at the **primary** (initiating) piece's footprint, so a combine can **replace a standing
  tower**. While a piece is selected, the pieces that would **fold together** are marked on
  the yard with a **pulsing highlight** so the player sees exactly what merges. With an
  explicit **shift-multi-select**, the exact chosen copies fold; otherwise the game resolves
  the ingredients itself (`specs/build.md`).
  - **Quality-combine.** A **COMBINE** action appears when the selected piece has a matching
    **candidate or base component** of the same type **and** same quality on the board
    (`specs/build.md`). Clicking it, or pressing **`C`**, immediately produces one component
    a tier higher at the initiating piece's footprint and consumes the partner — whose
    footprint **hardens into a blocker** so the maze is unchanged. A **Tesla-Prime** piece
    offers no quality-combine.
  - **Recipe-combine.** When the board (candidates **and/or** existing base components),
    together with the selected initiator, holds the exact multiset of `(type, quality)`
    ingredients a **combination recipe** needs (`specs/towers.md`), the inspector shows each
    reachable recipe and a **COMBINE → `<combo name>`** action naming the combination tower
    it would build. Clicking that action immediately assembles it: the combination tower
    lands at the initiator's footprint (landing at **upgrade level 0**), and **every consumed
    ingredient footprint hardens into a blocker** — wall-neutral, never opening a hole
    (`specs/build.md`, `specs/board.md`). A combo is not a base structure, so it never
    itself offers a COMBINE.
- **Downgrade.** With a **base structure** at Tuned (T2) or above selected in the build
  phase, the inspector shows a **DOWNGRADE** control — or press **`G`** — that drops it one
  quality tier in place, for **no Charge** and no refund (`specs/build.md`). It is a
  recipe-flexibility correction; a combination tower and a blocker cannot be downgraded.
- **Upgrade quality / upgrade combo.** The **`U`** key and the build-panel controls are
  contextual: with a **combination tower** selected, **UPGRADE** raises that combo's level
  for Charge (build phase, up to level 3, `specs/towers.md`); otherwise **UPGRADE QUALITY**
  buys the next **Refinement** level, biasing future rolls toward higher qualities
  (`specs/build.md`). Refinement is disabled at **R5** or when you cannot afford the next
  cost; a combo upgrade is disabled at level 3 or when you cannot afford it.
- **Targeting.** With a **firing component** selected, the inspector shows a
  **targeting** control that **cycles** its priority — `first` → `last` → `nearest` →
  `strongest` → `weakest` and back — on each click or press of **`T`**. The priority
  applies to that component only, defaults to **`first`** (furthest along the waypoint
  chain), and takes effect immediately (`specs/towers.md`). Targeting may be changed at
  any time, including during a live wave, since it is not a build action. A **non-firing**
  piece — the **Regulator**, whose only effect is its aura (`specs/towers.md`) — has **no
  targeting control**, since it never picks a target. The automatic abilities (slow,
  burn, crit, multishot, aura) need **no player controls** — they apply on their own when
  a component that carries them fires or radiates.
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

## HUD readouts and overlays

Beyond the core resources, the status bar carries a few **information aids** the player
can read or toggle at any time during play (both build and live-wave phases). Each must be
operable with the **mouse alone**, with a keyboard accelerator as an alternative.

- **Maze length.** The status bar shows **how long the current maze is** — the length of
  the **ground route** the Load walks through the ordered waypoint chain around your walls
  (`specs/board.md`), expressed in a stable unit (e.g. tiles). It updates live as you build,
  so the player can see a placement lengthen the route. **Hovering** the readout draws the
  **full ground path** on the yard (a highlighted line from Entry through every waypoint to
  the Collector). This is the **walking** route only: **air units ignore the maze**
  (`specs/enemies.md`, `specs/board.md`), so the flyers' straight-line path is not part of
  this figure and is not drawn.
- **Combinations (recipe book).** A **COMBOS** toggle — or **`V`** — opens an in-game
  reference listing **every combination tower**, each with its exact **recipe**
  (`(type, quality)` ingredients) and headline stats (`specs/towers.md`, `specs/build.md`),
  so the player can plan combines without leaving the game. Toggling it again (or its close
  control) dismisses it. It is a read-only overlay and does not pause or alter the game.
- **Damage leaderboard.** A **DMG BOARD** toggle — or **`L`** — opens a **live ranking of
  the player's towers by total damage dealt**, updating in **real time** as the wave runs
  (it may also show each tower's kills). Toggling it again (or its close control) dismisses
  it. Like the recipe book, it is a read-only overlay.

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
once per press (pulling the press, keeping, combining, downgrading, upgrading, sending a
wave, toggling speed, pausing, cycling targeting):

- **Pull the scrap-press (STAMP):** `B`
- **Keep selected candidate:** `K`
- **Combine the current selection:** `C` — folds a matching quality pair or a recipe
  multiset, immediately, in the build phase or a live wave. With a shift-multi-select it
  folds that exact set; otherwise it auto-resolves. A specific recipe (when several are in
  reach) is committed with the mouse via the named **COMBINE → `<combo name>`** action.
- **Shift-click:** add / remove a base structure from the explicit combine set.
- **Downgrade selected base component one tier (build phase):** `G`
- **Upgrade — the selected combo's level, else UPGRADE QUALITY (Refinement):** `U`
- **Cycle targeting priority (component selected):** `T`
- **Cancel held rock / deselect / back:** `Esc`
- **Send wave; in-place pause once live:** `Space`
- **Speed toggle (`1×`/`2×`):** `F`
- **Toggle the combinations recipe book:** `V`
- **Toggle the live tower damage leaderboard:** `L`
- **Mute:** `M`

Whatever exact keys you choose, list them in the in-game **How to play** screen
(`specs/flow.md`) and in the produced `README.md`.
