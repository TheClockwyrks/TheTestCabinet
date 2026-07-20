# Flow: economy, the surface loop, states, menus, and HUD

This file defines the Credits economy, the surface loop, the game's state machine, the
required menus, the HUD, scoring, and what is out of scope. It refers to mining and
selling (`specs/mining.md`), upgrades (`specs/upgrades.md`), the rocket
(`specs/rocket.md`), the miner's fuel/hull/death (`specs/character.md`), the hazards
(`specs/hazards.md`), the modes (`specs/modes.md`), and the controls
(`specs/controls.md`). The numeric values here are fixed; implement them exactly.

## Credits and the economy

Credits are the currency. There is exactly one source and four sinks:

- Source, selling ore. Selling your cargo at the Ore Market (`specs/mining.md`) pays
  each ore's listed value and empties the bay. This is the only way to earn Credits.
- Sink, fuel and repair. Buying jetpack fuel and hull repair at the Fuel Depot
  (`specs/character.md`, `specs/world.md`), per unit and per point. Fuel and hull never
  refill for free or on their own; restoring them is a running cost of every trip.
- Sink, upgrades. Buying tiers on the seven upgrade tracks (fuel tank, drill, cargo
  bay, hull, jetpack, radiator, scanner) at the Upgrade Shop (`specs/upgrades.md`).
- Sink, field supplies. Buying the six single-use field supply items (explosives,
  teleporters, nanobots, emergency fuel) at the Supply Depot, its own surface building,
  separate from the Upgrade Shop (`specs/items.md`, `specs/world.md`). Each is bought
  with Credits and carried as a count.
- Sink, the rocket. Fabricating the five rocket components at the Launch Pad
  (`specs/rocket.md`).

You start with `0` Credits and an empty cargo. Credits never go negative; an action you
cannot afford is disabled. Credits are banked: once earned they are safe, and they
survive death in both modes (`specs/modes.md`).

## The surface loop

The surface camp (`specs/world.md`) is the hub every dig returns to. Arriving at the
surface:

- Does not refuel or repair on its own. Fuel and Hull are exactly what the miner
  climbed out of the mine with (`specs/character.md`, `specs/world.md`). The surface is
  where you can pay to restore them, not where they restore for free.
- lets you sell (Ore Market), buy fuel and hull repair (Fuel Depot), upgrade (Upgrade
  Shop), buy field supplies (Supply Depot), and fabricate rocket parts (Launch Pad) via
  each building's overlay panel, and save (Save Pad) on the spot (`specs/controls.md`).

The rhythm of the game is: descend and fill cargo (and hunt a material, or make the
core run), climb back before fuel or hull runs out, sell, pay to refuel and repair,
spend what is left on the upgrade or rocket part this trip earned, and go again, a
little deeper each time.

## Saving and continuing

The expedition can be saved so a session can be resumed later. Saving is explicit and
restricted:

- Only at the Save Pad. The surface Save Pad building (`specs/world.md`) is the only way
  to save; there is no autosave and no saving underground. The pad has no menu:
  activating it (the activate key or a click) writes the save directly, with a note
  confirming it (or explaining why it is blocked, for example the Core Sample is live).
- One save at a time. There is a single save slot; saving overwrites it. Starting a NEW
  EXPEDITION abandons any existing save.
- CONTINUE. When a save exists, the main menu shows a CONTINUE entry that resumes it
  exactly where it was saved (`specs/flow.md`, Game states).
- What a save holds. Enough to resume the surface state: the generated mine (at its
  world size, `specs/world.md`, so a restored expedition keeps its dimensions), banked
  Credits, all upgrade tiers, installed rocket components, held field-supply item counts
  (`specs/items.md`), the cargo and materials, and the miner's fuel and hull. Saving is
  refused while the unstable Core Sample's timer is running, whether it is carried or
  jettisoned as a ground item (`specs/hazards.md`, `specs/items.md`), so its timer is
  never frozen out by saving and quitting.
- When the save ends. A Hardcore death deletes the save (permadeath); a victory consumes
  it. A Standard death keeps it, so the run can be restored from the Game Over screen
  (`specs/modes.md`).

The implementation may persist the save however it likes within the browser (for
example `localStorage`); the game must still run if that storage is unavailable, simply
without saving. This is the one persisted-progress feature; everything else is
per-session.

## Game states

The game is a small state machine. Each state has a clear screen and controls
(`specs/controls.md`).

1. Title / main menu. Shows the title `DEEPCORE`, a tagline, and a vertical menu. When a
   saved expedition exists (below), a `CONTINUE` entry appears first (resuming the
   save); then the expedition start defined by `specs/mode.md` (which declares its
   entry, `NEW EXPEDITION`), followed by `HOW TO PLAY`. The selected item is
   highlighted. A dim slice of the mine may show behind the menu for atmosphere.
2. Mode select. Reached from the expedition start on the main menu (`specs/mode.md`).
   Lets the player choose Standard or Hardcore (`specs/modes.md`), each showing what its
   death rule is before it is chosen. Choosing one advances to Size select (the
   expedition begins once a size is picked); a BACK choice returns to the main menu.
3. Size select. Reached from Mode select. Lets the player choose the world size, Quick
   (half-depth), Standard (the reference mine), or Marathon (double-depth), each showing
   how deep its Core is before it is chosen (`specs/world.md`). The size scales only how
   deep the mine goes, not its difficulty. Choosing one begins a fresh expedition in the
   mode picked previously at that size; a BACK choice returns to Mode select.
4. How to play. Describes the goal (build the escape rocket and launch), the controls,
   the dig-sell-upgrade loop, that digging goes down / left / right but never up, fuel
   and the climb home, the hazards (gas, lava, the unstable core), the exotic materials
   and the scanner, and the two modes. Returns to the main menu.
5. In mine. The live game: the tiled world through the vertical camera, the miner
   digging and falling and thrusting, the ore and materials, the hazards, and, when the
   miner is at the surface, the six buildings (Fuel Depot, Ore Market, Save Pad, Upgrade
   Shop, Supply Depot, Launch Pad); all but the Save Pad open an overlay panel, while
   the Save Pad saves directly. The inventory overlay (`specs/mining.md`) can also be
   opened here, at the surface or mid-dig. This one state covers both the surface and the
   whole descent; the camera and the open panels are what change.
6. Paused. The `Esc` overlay menu, reachable in the mine. Offers Resume, Restart, and
   Quit to menu, over a frozen, dimmed world. Pausing freezes the whole simulation: the
   miner, the physics, the fuel burn, and the Core Sample countdown all hold together
   while the menu is up, and all resume when you do. Pause is not a way to buy time on
   the core run: resuming resumes the countdown exactly where it stopped.
7. Victory. Shown when the rocket launches (`specs/rocket.md`). Displays the run summary
   (deepest depth reached, Credits earned, elapsed time, and mode) with PLAY AGAIN (a
   fresh expedition in the same mode and world size) and MENU. Winning consumes the save
   (below).
8. Game Over. Shown when the miner dies in either mode (`specs/modes.md`,
   `specs/character.md`). Displays the run summary (deepest depth reached, Credits,
   rocket components installed, and how the miner died). The options depend on the mode
   (`specs/modes.md`): in Standard, if a save exists, CONTINUE FROM SAVE (restore the
   last save) and MENU; in Hardcore (or Standard with no save), PLAY AGAIN (a fresh
   expedition in the same mode and world size) and MENU. A Hardcore death deletes the
   save (permadeath); a Standard death leaves it intact so it can be restored.

## Required menus

Every menu and screen below must be present and reachable. Each entry states its
content and its navigation; the visual layout is yours, subject to the palette and type
of `specs/overview.md`. The expedition start's menu entry is in `specs/mode.md`; the
mode content is in `specs/modes.md`.

- Main menu: the title, a tagline, a CONTINUE entry when a save exists (resumes it), the
  expedition start from `specs/mode.md` (`NEW EXPEDITION`), then HOW TO PLAY. The start
  goes to mode select; HOW TO PLAY goes to the how-to-play screen.
- Mode select: an entry for Standard and Hardcore, each showing its death rule before
  selection (`specs/modes.md`); choosing one goes to Size select; BACK goes to the main
  menu.
- Size select: an entry for Quick, Standard, and Marathon, each showing how deep its
  mine goes before selection (`specs/world.md`); choosing one begins a fresh expedition
  in the mode picked at Mode select, at that size; BACK goes to Mode select.
- How to play: the goal, the controls, the dig loop, the fuel/climb tension, the cargo
  (slots plus weight and the inventory drop), the hazards, the materials and scanner,
  saving, and the two modes; a way back to the main menu.
- Building panels: the surface overlays. Fuel Depot (buy fuel and hull repair for
  Credits, a fixed increment or fill/repair-to-full, paying only for the missing amount,
  `specs/character.md`), Ore Market (the cargo breakdown and SELL), Upgrade Shop (the
  seven tracks with current tier, next-tier effect, and price, `specs/upgrades.md`),
  Supply Depot (the six single-use field supplies with icon, price, and held count, and
  a BUY each, `specs/items.md`), and Launch Pad (the five-component rocket checklist and
  FABRICATE / LAUNCH, `specs/rocket.md`). Each opens when the miner activates the
  building and closes back to the mine. The Save Pad is not a panel; activating it saves
  directly (`specs/modes.md`).
- Inventory overlay: the cargo hold (`specs/mining.md`), the held ore with counts and
  weights, the slots/load readout, a drop control per ore, and a Field Supplies section
  with each held item's count and a USE control (plus the Core Sample jettison control
  while carrying it, `specs/items.md`). Openable anywhere.
- Pause menu: Resume, Restart, and Quit to menu, over the frozen mine.
- Victory screen: the run summary with PLAY AGAIN and MENU.
- Game Over screen: the run summary with, in Standard (save present), CONTINUE FROM SAVE
  and MENU, else PLAY AGAIN and MENU (`specs/modes.md`). PLAY AGAIN starts a fresh
  expedition in the same mode and world size; MENU returns to the main menu.

Every menu and panel must be operable with the mouse; the keyboard accelerators of
`specs/controls.md` are an alternative. This specification fixes the content and
navigation, not the layout.

## HUD

The HUD is the top status bar (`y in [0, 56]`, `specs/overview.md`), drawn in code
(`specs/assets.md`; only its small icons may be produced sprites), always fully
visible:

- Fuel gauge (turning to the alert color under 20%, with the low-fuel alarm,
  `specs/character.md`);
- Hull gauge (turning to the alert color under 25%);
- Cargo as slots used over capacity (`specs/mining.md`) with the current load in kg
  alongside, turning to the alert color when the bay is full and reading OVERLOAD when
  the haul is too heavy for the jetpack to lift (`specs/character.md`);
- Credits (`specs/rocket.md`, `specs/upgrades.md`);
- Depth in meters (`specs/world.md`);
- the materials satchel (which of Resonite / Cryenite you hold);
- the inventory (bag), pause, and mute controls.

Over the world, the HUD also draws the scanner indicator (the directional arrow plus
distance to the nearest needed material, `specs/mining.md`, drawn in code) only while
the scanner is locked on (nothing is shown when no needed material is in range) and,
while the Core Sample is being carried, the prominent destabilization countdown with
its escalating alarm and a jettison hint (`specs/hazards.md`, `specs/items.md`). A
jettisoned Core Sample shows its countdown over its ground tile (`specs/items.md`). The
first-time hazard tip (the one-time dismissible card explaining the first gas or lava
hit that hurts the miner, `specs/hazards.md`) is also drawn here over the world; it is
non-blocking and auto-fades. A player must be able to read, without hunting, how much
fuel and hull they have left, how full the cargo is, how deep they are, and, on the
core run, how many seconds remain.

## Scoring / summary

There is no running numeric score. The end screens (Victory, Game Over) show a run
summary: deepest depth reached (m), total Credits earned, elapsed time, mode, and
rocket components installed. The summary is for the result screen only and is not
persisted; the only persisted state is the save (above).

## Out of scope

- Network or online multiplayer, and any cloud or account-based progress. (The single
  local save of "Saving and continuing" above is in scope; nothing beyond it.)
- Touch or gamepad input (mouse and keyboard only for this version).
- A boss fight or any combat: Deepcore has no enemies (`specs/hazards.md`); the mine is
  the only adversary. This is deliberate.
- Selling fuel or hull back for Credits: the Fuel Depot only sells fuel and repair to
  the miner (`specs/character.md`, `specs/world.md`); there is no buy-back and no
  fuel/hull market beyond the depot.
- Any ore, material, hazard, building, or upgrade track beyond those specified here;
  keep the scope to the systems specified across these files, done well. (The six
  single-use field supplies and the Core Sample jettison / ground item of
  `specs/items.md` are in scope; they are specified mechanics, not additions beyond the
  spec.)
