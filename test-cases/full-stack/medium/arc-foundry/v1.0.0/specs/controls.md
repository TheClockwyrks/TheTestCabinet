# Arc Foundry — Controls

This file defines how the player interacts with the yard: the simulation step,
pulling the scrap-press and placing the stamped component, selecting and
inspecting a component, the **slag / sell / combine / targeting** controls,
driving the waves, and the speed and pause controls. It builds on the tile grid
and build-panel layout in `specs/board.md`, the components in `specs/towers.md`,
the build loop in `specs/build.md`, and the flow in `specs/flow.md`. Mouse and
keyboard only; no touch or gamepad for this version, and **every interaction and
menu must be achievable with the mouse alone**, with the keyboard shortcuts as
accelerators.

## Simulation

Run the simulation on a **fixed timestep** — the **tick** (for example 60 Hz) —
decoupled from rendering, so unit movement, live re-pathing, component fire,
projectiles, and the economy are reproducible and independent of the render
frame rate. Render with smooth interpolation between ticks. The **speed control**
(below) scales how many ticks pass per real second; it must change only how fast
the game plays, never the *outcome*. **Pause** halts ticks entirely, and comes in
two forms that both freeze ticks but differ in what else they do — an **in-place
pause** that leaves the yard interactive, and the **pause menu**, both described
under *Waves, speed, and pause* below.

## Stamping and placing a component (the scrap-press)

The player builds only by **pulling the scrap-press**, which stamps one random
component to position on the grid (`specs/build.md`):

1. **Pull the press.** Click the **STAMP** control in the build panel
   (`specs/board.md`), or press its hotkey **`B`**, to pull the press. Each pull
   costs **18 Charge** and spends **one** of the level's fixed **5-stamp
   allowance** (`specs/build.md`); STAMP is refused (clearly) when you cannot
   afford 18 or the allowance is spent. A pull immediately rolls a **random
   component type at a random quality** on the pinned odds (`specs/build.md`) —
   the roll is fixed at the pull and the stamped component must be placed.
2. **Position.** The rolled component is then **held on the cursor** as its
   uniform **`2×2` tile footprint** (`specs/board.md`), snapping to the grid under
   the pointer. The preview shows the component's **range ring** and a
   **legal/illegal** footprint cue (`#46d07a` legal, `#ff4d4d` illegal). A
   footprint is illegal if any of its four tiles is off the board, already blocked
   by a component, slag wall, or fixed housing, or if placing it would **seal**
   any waypoint segment or trap a walking unit (the **never-seal rule**,
   `specs/board.md`).
3. **Place.** Left-click a **legal** footprint to drop the component there; it
   lands **ACTIVE** (firing + walling) and the floor **re-paths live**
   (`specs/board.md`). A **build spark** VFX fires at the new footprint
   (`specs/assets.md`).

A pull is committed once rolled — there is no cancel that refunds it — but a
component placed during a build phase can be sold or slagged for its **full**
invested value until that wave starts (`specs/build.md`, `specs/flow.md`), so the
opening build is fully re-shapeable. Pulling is allowed during the build phase
**and** during a live wave, up to the 5-stamp allowance (`specs/build.md`).

## Selecting and inspecting a component

- **Select.** Left-click a placed component or slag wall (when not positioning a
  stamp) to select it. The selected component shows its **range ring** on the
  yard, and the **inspector** in the build panel (`specs/board.md`) shows its
  **type**, **quality tier**, live stats (damage, range, fire rate, targeting),
  and its action controls. A slag wall reads as inert (no range, no targeting) and
  offers only **SELL**.
- **Slag.** With an active component selected, click **SLAG** in the inspector or
  press **`G`** to fuse it into an inert **slag wall** — it stops firing but keeps
  walling — refunding a flat **12 Charge** (`specs/build.md`). Slag is a one-way
  conversion.
- **Sell.** Click **SELL** or press **`S`** to sell the selected component or slag
  wall, freeing its footprint and re-pathing the floor. An active component
  refunds **70%** of its invested value (or its **full** invested value inside the
  pre-wave window, `specs/build.md`); a slag wall sells for **6**
  (`specs/build.md`, `specs/flow.md`).
- **Combine.** **COMBINE** appears in the inspector **only** when the selected
  active component has **another active component of the same type and same
  quality** somewhere on the board (`specs/build.md`). Clicking it, or pressing
  **`C`**, consumes both, produces one component **one quality tier higher at the
  selected component's footprint**, frees the other footprint (re-pathing the
  floor), costs **no Charge**, and fires a **combine flash** VFX
  (`specs/assets.md`). A **Tesla-Prime** component is the apex and offers no
  COMBINE.
- **Targeting.** With a **damage** component selected, the inspector shows a
  **targeting** control that **cycles** its priority — `first` → `last` →
  `nearest` → `strongest` → `weakest` and back — on each click or press of
  **`T`**. The priority applies to that component only, defaults to **`first`**
  (furthest along the waypoint chain), and takes effect immediately
  (`specs/towers.md`). Coil and Arc-Node use it to pick their **primary** target,
  then chain / splash around it.
- **Deselect.** Click empty yard or press **`Esc`** to deselect.

## Waves, speed, and pause

- **Start / send wave.** The **START** control in the build panel
  (`specs/board.md`) — or **`Space`** — starts the next wave. The **opening**
  build phase before Wave 1 is untimed, reads **START**, and begins Wave 1 only
  when pressed, with no early-send bonus (`specs/flow.md`). Between waves the
  15-second build-phase countdown runs; pressing it then **sends the next wave
  early**, paying the early-send bonus (`specs/flow.md`), and letting the timer
  expire auto-starts the wave. Once a wave is **live**, **`Space`** instead toggles
  the **in-place pause** (below) — there is no wave to send mid-wave.
- **Speed.** A **speed** toggle in the panel — or **`F`** — cycles the game speed
  between **`1×`** and **`2×`**, scaling how many ticks pass per second (the
  current speed is shown, `specs/board.md`). It applies to the whole simulation and
  persists until changed.
- **In-place pause.** A dedicated **pause** control in the status bar — and, once
  a wave is live, **`Space`** — **pauses and resumes in place**: it freezes ticks
  (the Load, fire, projectiles, the economy, and any build-phase countdown all
  halt) **without** opening a menu, and the yard **stays fully interactive** — you
  can keep pulling the press, positioning, selecting, slagging, selling, and
  combining on the still board, then resume. The frozen state reads clearly as
  **PAUSED** (`specs/board.md`). This is distinct from the pause **menu** below.
- **Pause menu.** **`Esc`** with nothing held or selected opens the **Paused**
  overlay menu — **Resume**, **Restart**, **Quit to menu** (`specs/flow.md`) —
  which also freezes the board behind it; while positioning a stamp or with a
  component selected, `Esc` first cancels that. Opening the menu freezes the game
  even if it was already paused in place, and **Resume** returns to normal running
  play, clearing any in-place pause.
- **Mute.** **`M`** — or the status-bar control — toggles audio mute
  (`specs/flow.md`).

## Menu navigation

In the title, map-select, difficulty-select, how-to-play, pause, victory, and
overload screens (`specs/flow.md`, `specs/modes.md`), the pointer and/or
`Up`/`Down` (or `W`/`S`) move the selection and `Enter`/`Space` confirms; `Esc`
backs out of a submenu to the previous screen. The map-select and
difficulty-select screens must let the player read what each choice changes
before confirming (`specs/modes.md`). Every menu must be fully operable with the
**mouse alone**, with these keyboard accelerators as an alternative.

## Keyboard shortcuts (accelerators)

The mouse path above is the primary pointing device; the shortcuts below are
**required** alongside it, and a held key must not auto-repeat an action meant to
fire once per press (pulling the press, sending a wave, toggling speed, pausing,
slagging, selling, combining, cycling targeting):

- **Pull the scrap-press (STAMP):** `B`
- **Slag / Sell selected:** `G` / `S`
- **Combine selected (when a match exists):** `C`
- **Cycle targeting priority:** `T`
- **Cancel stamp / deselect / back:** `Esc`
- **Start / send wave; in-place pause once live:** `Space`
- **Speed toggle (`1×`/`2×`):** `F`
- **Mute:** `M`

Whatever exact keys you choose, list them in the in-game **How to play** screen
(`specs/flow.md`) and in the produced `README.md`.
