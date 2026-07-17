# Controls — the simulation and the inputs

This file defines the fixed-timestep simulation and the keyboard and mouse controls.
It refers to the miner's movement and drilling (`specs/character.md`), the world and
its buildings (`specs/world.md`), the surface panels (`specs/flow.md`,
`specs/upgrades.md`, `specs/rocket.md`), and the states (`specs/flow.md`). The
bindings are the reference set; keep them or an equivalent, but every action below
must be reachable.

## The simulation

The game runs a **fixed-timestep** simulation (a constant logic tick, e.g. 60 Hz,
decoupled from render) so movement, fuel burn, drill timers, fall physics, and the
Core Sample countdown are deterministic and framerate-independent. Rendering
interpolates or samples the latest state; logic never runs faster on a faster machine.

## Movement and drilling

The miner is driven continuously (hold a direction to keep moving/drilling), not by
discrete tile steps:

- **Move / drill left** — `A` or `Left Arrow`. In open space, moves left; once the
  miner reaches the **edge** of its tile against a **minable** tile — and only while
  **standing on solid ground** — it **drills** that tile (`specs/character.md`), then
  moves into the tunnel. Pressing left in **mid-tile** walks first; pressing left while
  **falling** does not drill.
- **Move / drill right** — `D` or `Right Arrow`. Symmetric.
- **Drill down** — `S` or `Down Arrow`. While **grounded**, drills the tile underfoot and
  **sinks smoothly into it** as it cuts, digging a shaft **tile by tile** with no
  teleport-snap (`specs/character.md`); it drills **only while grounded** — with open space
  below (or while falling) it does nothing special and the miner simply falls.
- **Jetpack thrust (up)** — `W`, `Up Arrow`, or `Space`. Fires the jetpack, climbing
  (or hovering at a light hold) and **burning fuel** (`specs/character.md`). How fast it
  climbs depends on the **load** (`specs/character.md`); there is **no drilling up** —
  thrust only moves through open tunnels.
- **Inventory (cargo hold)** — `I`, or the status-bar **BAG** control. Opens/closes the
  inventory overlay (`specs/mining.md`) — usable **anywhere**, surface or mid-dig — where
  the player reviews the haul and **drops specific ore** to lighten an overloaded load so
  the jetpack can lift off again (`specs/character.md`). Dropped ore is lost, not sold.
  The inventory also has a **Field Supplies** section with a **USE** control per held item
  and, while carrying the Core Sample, a **JETTISON** control (`specs/items.md`).
- **Field supplies** — number keys **`1`–`6`** use the six single-use field-supply items
  1–6 during live play (`specs/items.md`); the inventory **USE** buttons are the mouse
  equivalent. Both paths run the same use logic, and using an item you hold none of is a
  harmless no-op.
- **Jettison the Core Sample** — `J` during live play (or the inventory **JETTISON**
  control) drops the carried Core Sample onto the miner's tile as a ground item, its timer
  still running, so the player can flee the blast (`specs/items.md`, `specs/hazards.md`).

Facing follows the last lateral input, and the miner's sprite mirrors to match
(`specs/character.md`, `specs/assets.md`). Movement is smooth and continuous; the miner
falls whenever unsupported.

## Surface buildings

At the surface, the miner activates a building by **standing at it** and pressing the
**activate** key (`E` or `Enter`), or by **clicking** the building. Most buildings open an
**overlay panel** (`specs/flow.md`); the Save Pad has no menu — activating it saves directly:

- **Fuel Depot** — buy fuel and hull repair for Credits (`specs/flow.md`,
  `specs/character.md`); close to return.
- **Ore Market** — the cargo breakdown and **SELL** (`specs/mining.md`).
- **Save Pad** — **no panel**: activating it **saves** the expedition to the single save
  slot on the spot, with a confirming note (or one explaining why it's blocked); the only
  place saving is possible (`specs/flow.md`).
- **Upgrade Shop** — the seven upgrade tracks; click a track's **BUY** to purchase its
  next tier (`specs/upgrades.md`).
- **Supply Depot** — the six single-use **field supplies**; click an item's **BUY** to
  purchase one (`specs/items.md`).
- **Launch Pad** — the rocket checklist; **FABRICATE** the next component, or **LAUNCH**
  when all five are installed (`specs/rocket.md`).

Panels are fully operable with the mouse; `Esc` (or a close control) dismisses a panel
back to the mine. Opening a panel at the surface may pause world motion behind it (the
miner is safe at the surface regardless).

## System controls

- **Pause menu** — `Esc` while in the mine opens the pause menu (Resume / Restart /
  Quit to menu, `specs/flow.md`), freezing the whole simulation behind it. `Esc` also
  closes an open building panel.
- **Dismiss a hazard tip** — the first-time gas / lava alert card (`specs/hazards.md`) is
  dismissed by a **click** on it or by pressing **`Space`** (or `Esc`); it is non-blocking
  and also auto-fades on its own, so no input is ever required to continue.
- **Mute** — `M`, or the status-bar mute control, toggles all audio (`specs/assets.md`).
- **Menus** — the title, mode-select, how-to-play, victory, and game-over screens are
  navigable by mouse (click an item) and by keyboard (`Up`/`Down` to move the
  selection, `Enter` to confirm, `Esc` to go back where a back exists).

Do not require any control not listed here; in particular the game must be fully
playable with the keyboard for movement/drilling/thrust plus the mouse for the surface
panels and menus.
