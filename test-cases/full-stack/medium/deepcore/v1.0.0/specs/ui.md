# Deepcore — UI: game states, menus, and the HUD

This file defines the game's screens — the state machine that moves between them and the
required menus and building panels — the heads-up display shown while mining, and what is
out of scope. It refers to the controls in `specs/controls.md`, the expedition, economy,
saving, and scoring in `specs/gameplay.md`, the mine and its surface buildings in
`specs/world.md`, the modes in `specs/modes.md`, mining and the cargo hold in
`specs/mining.md`, upgrades in `specs/upgrades.md`, the rocket in `specs/rocket.md`, the
field supplies in `specs/items.md`, the miner in `specs/character.md`, and the hazards in
`specs/hazards.md`.

## Game states

The game is a small state machine. Each state has a clear screen and controls
(`specs/controls.md`).

1. Title / main menu. Shows the title `DEEPCORE`, a tagline, and a vertical menu. When a
   saved expedition exists (below), a `CONTINUE` entry appears first (resuming the
   save); then the expedition start defined by `specs/gameplay.md` (which declares its
   entry, `NEW EXPEDITION`), followed by `HOW TO PLAY`. The selected item is
   highlighted. A dim slice of the mine may show behind the menu for atmosphere.
2. Mode select. Reached from the expedition start on the main menu (`specs/gameplay.md`).
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
   (`specs/gameplay.md`).
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
of `specs/overview.md`. The expedition start's menu entry is in `specs/gameplay.md`; the
mode content is in `specs/modes.md`.

- Main menu: the title, a tagline, a CONTINUE entry when a save exists (resumes it), the
  expedition start from `specs/gameplay.md` (`NEW EXPEDITION`), then HOW TO PLAY. The start
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

## Out of scope

- Network or online multiplayer, and any cloud or account-based progress. (The single
  local save of "Saving and continuing" (`specs/gameplay.md`) is in scope; nothing
  beyond it.)
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
