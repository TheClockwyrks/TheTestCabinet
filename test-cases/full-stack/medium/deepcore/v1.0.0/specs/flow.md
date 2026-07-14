# Flow — economy, the surface loop, states, menus, and HUD

This file defines the **Credits** economy, the **surface loop**, the game's **state
machine**, the required **menus**, the **HUD**, scoring, and what is out of scope. It
refers to mining and selling (`specs/mining.md`), upgrades (`specs/upgrades.md`), the
rocket (`specs/rocket.md`), the miner's fuel/hull/death (`specs/character.md`), the
hazards (`specs/hazards.md`), the modes (`specs/modes.md`), and the controls
(`specs/controls.md`). The numeric values here are **fixed**; implement them exactly.

## Credits and the economy

**Credits** are the currency. There is exactly **one source** and **two sinks**:

- **Source — selling ore.** Selling your cargo at the **Ore Market**
  (`specs/mining.md`) pays each ore's listed value and empties the bay. This is the
  only way to earn Credits.
- **Sink — upgrades.** Buying tiers on the five upgrade tracks at the **Upgrade Shop**
  (`specs/upgrades.md`).
- **Sink — the rocket.** Fabricating the five rocket components at the **Launch Pad**
  (`specs/rocket.md`).

You start with **`0` Credits** and an empty cargo. Credits never go negative; an
action you cannot afford is disabled. Credits are **banked** — once earned they are
safe, and they **survive death** in both modes (`specs/modes.md`).

## The surface loop

The surface camp (`specs/world.md`) is the hub every dig returns to. Arriving at the
surface:

- **Refuels and repairs for free** — Fuel and Hull refill to their current maxima the
  moment the miner is home (`specs/character.md`, `specs/world.md`). The whole fuel
  budget of a dig is measured against this safe return.
- lets you **sell** (Ore Market), **upgrade** (Upgrade Shop), and **fabricate rocket
  parts** (Launch Pad) via each building's overlay panel (`specs/controls.md`).

The rhythm of the game is: descend and fill cargo (and hunt a material, or make the
core run), climb back before fuel or hull runs out, sell, spend on the upgrade or
rocket part this trip earned, and go again — a little deeper each time.

## Game states

The game is a small state machine. Each state has a clear screen and controls
(`specs/controls.md`).

1. **Title / main menu.** Shows the title `DEEPCORE`, a tagline, and a vertical menu
   listing the expedition start defined by `specs/mode.md` (which declares its entry,
   `NEW EXPEDITION`), followed by `HOW TO PLAY`. The selected item is highlighted. A
   dim slice of the mine may show behind the menu for atmosphere.
2. **Mode select.** Reached from the expedition start on the main menu
   (`specs/mode.md`). Lets the player choose **Standard** or **Hardcore**
   (`specs/modes.md`), each showing what its death rule is before it is chosen.
   Choosing one begins a fresh expedition in that mode; a **BACK** choice returns to
   the main menu.
3. **How to play.** Describes the goal (build the escape rocket and launch), the
   controls, the dig-sell-upgrade loop, that digging goes **down / left / right but
   never up**, fuel and the climb home, the hazards (gas, lava, the unstable core),
   the exotic materials and the scanner, and the two modes. Returns to the main menu.
4. **In mine.** The live game: the tiled world through the vertical camera, the miner
   digging and falling and thrusting, the ore and materials, the hazards, and — when
   the miner is at the surface — the four buildings and their overlay panels (Fuel
   Depot, Ore Market, Upgrade Shop, Launch Pad). This one state covers both the
   surface and the whole descent; the camera and the open building panels are what
   change.
5. **Paused.** The `Esc` overlay menu, reachable in the mine. Offers **Resume**,
   **Restart**, and **Quit to menu**, over a frozen, dimmed world. Pausing freezes the
   whole simulation — the miner, the physics, the fuel burn, and the Core Sample
   countdown all hold together while the menu is up, and all resume when you do. Pause
   is not a way to buy time on the core run: resuming resumes the countdown exactly
   where it stopped.
6. **Victory.** Shown when the rocket launches (`specs/rocket.md`). Displays the run
   summary — deepest depth reached, Credits earned, elapsed time, and mode — with
   **PLAY AGAIN** (a fresh expedition in the same mode) and **MENU**.
7. **Game Over.** Shown **only in Hardcore**, when the miner dies (`specs/modes.md`,
   `specs/character.md`). Displays the run summary — deepest depth reached, Credits,
   rocket components installed, and how the miner died — with **PLAY AGAIN** (a fresh
   Hardcore expedition) and **MENU**. **Standard has no Game Over from death**: a
   Standard death drops the haul and respawns the miner at the surface (`specs/modes.md`),
   and the run continues until the player wins or quits.

## Required menus

Every menu and screen below must be present and reachable. Each entry states its
**content** and its **navigation**; the visual layout is yours, subject to the palette
and type of `specs/overview.md`. The expedition start's menu entry is in
`specs/mode.md`; the mode content is in `specs/modes.md`.

- **Main menu** — the title, a tagline, the expedition start from `specs/mode.md`
  (`NEW EXPEDITION`), then **HOW TO PLAY**. The start → mode select; HOW TO PLAY → the
  how-to-play screen.
- **Mode select** — an entry for **Standard** and **Hardcore**, each showing its death
  rule before selection (`specs/modes.md`); choosing one → begins a fresh expedition in
  that mode; **BACK** → the main menu.
- **How to play** — the goal, the controls, the dig loop, the fuel/climb tension, the
  hazards, the materials and scanner, and the two modes; a way back to the main menu.
- **Building panels** — the four surface overlays: **Fuel Depot** (a confirmation that
  fuel and hull are topped up — free), **Ore Market** (the cargo breakdown and
  **SELL**), **Upgrade Shop** (the five tracks with current tier, next-tier effect,
  and price, `specs/upgrades.md`), and **Launch Pad** (the five-component rocket
  checklist and **FABRICATE** / **LAUNCH**, `specs/rocket.md`). Each opens when the
  miner activates the building and closes back to the mine.
- **Pause menu** — **Resume**, **Restart**, and **Quit to menu**, over the frozen mine.
- **Victory screen** and (Hardcore) **Game Over screen** — the run summary with **PLAY
  AGAIN** and **MENU**. PLAY AGAIN starts a fresh expedition in the same mode; MENU
  returns to the main menu.

Every menu and panel must be operable with the mouse; the keyboard accelerators of
`specs/controls.md` are an alternative. This specification fixes the **content and
navigation**, not the layout.

## HUD

The HUD is the top **status bar** (`y in [0, 56]`, `specs/overview.md`), drawn in code
(`specs/assets.md`; only its small icons may be produced sprites), always fully
visible:

- **Fuel** gauge (turning to the alert color under 20%, with the low-fuel alarm,
  `specs/character.md`);
- **Hull** gauge (turning to the alert color under 25%);
- **Cargo** as **used / capacity** (`specs/mining.md`);
- **Credits** (`specs/rocket.md`, `specs/upgrades.md`);
- **Depth** in meters (`specs/world.md`);
- the **materials satchel** (which of Resonite / Cryenite you hold);
- the **pause** and **mute** controls.

Over the world, the HUD also draws the **scanner indicator** (the directional arrow +
distance to the nearest needed material, `specs/mining.md`, drawn in code), and, while
the Core Sample is being carried, the prominent **destabilization countdown** with its
escalating alarm (`specs/hazards.md`). A player must be able to read, without hunting,
how much fuel and hull they have left, how full the cargo is, how deep they are, and —
on the core run — how many seconds remain.

## Scoring / summary

There is no running numeric score. The **end screens** (Victory, Game Over) show a run
**summary**: deepest depth reached (m), total Credits earned, elapsed time, mode, and
rocket components installed. It is for the result screen only and is **not persisted**
between sessions.

## Out of scope

- Network or online multiplayer, and any saved/persisted progress between sessions.
- Touch or gamepad input (mouse and keyboard only for this version).
- A boss fight or any combat — Deepcore has **no enemies** (`specs/hazards.md`); the
  mine is the only adversary. This is deliberate.
- Buying or selling fuel/hull — refuel and repair are **free at the surface**
  (`specs/world.md`); Credits are spent only on upgrades and the rocket.
- Any ore, material, hazard, building, upgrade track, or mechanic beyond those
  specified here — keep the scope to the systems above, done well.
