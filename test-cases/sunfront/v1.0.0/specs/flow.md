# Sunfront — Flow, states, controls, HUD, and the AI

This file defines win and loss, the game-state machine, the controls, the HUD,
the AI opponent, and what is out of scope. It refers to the geometry in
`specs/playfield.md`, the economy in `specs/economy.md`, the roster in
`specs/units.md`, and the wave clock in `specs/waves.md`.

## Winning and losing

- Each **base** has `1200 HP` (`specs/playfield.md`). A match ends the instant
  either base reaches `0 HP`.
- **You win** when the **enemy base** is razed; **you lose** when **your base**
  is razed. There is no timeout, score, or draw — the tug-of-war runs until one
  base falls. On match end, go to the **match-over** state showing the outcome.

## Game states

The build is a small state machine. Each state has a clear screen and controls.

1. **Title / main menu.** Shows the title `SUNFRONT`, the tagline `TUG-OF-WAR ON
   THE DUNE FRONT`, and a vertical menu with the playable mode's entry (defined by
   the `standard` spec), then `HOW TO PLAY`. The selected item is highlighted. A dimmed slice
   of the battlefield may show behind the menu.
2. **How to play.** A screen explaining the loop (build spawners and Solar
   Extractors -> waves march -> counter what you see through the fog -> raze the
   enemy base), the resource and wave clocks, the counter triangle in brief, and
   the controls. Returns to the menu.
3. **In match.** The live game, seen through the low oblique command camera
   (`specs/overview.md`), which frames a **scrollable portion** of the 3D battlefield —
   the full width of the lane and the stretch of it you are looking at: the armies and
   the front, the player's staging yard with its build grid (when scrolled to your
   corner), the build palette, and the HUD overlay, with the rest of the arena and the
   fogged enemy yard reached by panning. This is where the whole of `specs/economy.md`,
   `specs/units.md`, and `specs/waves.md` plays out.
4. **Paused.** Reachable from a match. Offers **Resume**, **Restart**, and **Quit
   to menu**. The field is visible but the simulation and both clocks are frozen
   behind the pause menu.
5. **Match over.** Shown when a base falls. Displays the outcome (`VICTORY` or
   `DEFEAT`), the wave count reached, with **PLAY AGAIN** and **MENU**.

Every state must be reachable and behave as described.

## Controls

The match is **mouse-driven** for building, with keyboard shortcuts; menus accept
both.

- **Menus / pause / match-over:** `Up`/`Down` (or `W`/`S`) move the selection,
  `Enter` or `Space` confirms, `Esc` goes back; menu items are also clickable.
- **Selecting what to build:** the **build palette** (below) lists the ten unit
  spawners and the Solar Extractor with their costs. Click a palette entry — or press
  its shortcut key (`1`-`9`, `0` for the tenth unit, and `E` for Solar Extractor) —
  to arm that structure type. The cursor then shows a ghost of the structure.
- **Placing:** click an **empty** build-grid cell in your staging yard to place
  the armed structure (if you can afford it — `specs/economy.md`). An invalid or
  unaffordable cell shows the invalid-placement color and does not place. `Esc`
  or right-click disarms the cursor.
- **Selecting a structure:** click any **friendly** structure — a placed build-grid
  structure (spawner or Solar Extractor), your **base**, or your **Reliquary** — to
  select it and open its panel (below). Clicking empty ground or pressing `Esc`
  deselects. Enemy structures (hidden or transient under fog, `specs/waves.md`) are
  not selectable.
- **Managing a build-grid structure:** for a selected **build-grid** structure the
  panel also carries its current effect (spawned unit stats for a spawner, income
  bonus for a Solar Extractor) and **Upgrade** (with cost) and **Sell** (with refund)
  buttons. Click a button, or press `U` to upgrade / `X` to sell the selected
  structure. The **base** and **Reliquary** are read-only: their panel shows their name
  and health only, with no upgrade or sell action.
- **In match:** `Esc` or `P` pauses.
- **Camera & scrolling:** the low oblique command camera (`specs/overview.md`) frames
  the full width of the combat corridor but only a stretch of its length, and starts
  centered on the player's own corner. **Pan** it along the lane to view from your
  staging yard up toward the enemy and back: **edge-scroll** (cursor at a screen edge)
  and the **arrow keys** (or `W`/`A`/`S`/`D`). A quick **re-center on your base**
  (bound to a key) is recommended. No zoom is required. An optional **minimap** you can
  click to jump the camera is allowed but not required.
- **Toggles:** a **performance overlay** (live FPS) and **wireframe mode** each
  have a key — state them on the how-to-play screen or a controls hint (e.g. `F3`
  performance, `F4` wireframe); both work during a live match (see **HUD**).

Keyboard-only players can still play: number keys arm types, and placement may
fall back to a keyboard-movable cursor over the grid if you choose to implement
one, but mouse placement is the primary path and must work.

## HUD

Drawn as a **screen-space overlay** over the 3D world, in the palette and monospace
type from `specs/overview.md`:

- **Top-left:** your **sol** balance (large) and your current **income rate**
  (`+N/s`), in the Ember color.
- **Top-center:** the **wave number** and the **countdown** to the next wave
  (`specs/waves.md`).
- **Top strip, flanking center:** the two **base health bars** — the player's
  base HP on the left, the enemy's on the right — each labelled, filling from the
  healthy to the critical color as HP drops.
- **Build palette:** a row or column of the ten buildable unit spawners plus the Solar
  Extractor near the player's staging yard, each showing its icon (in team color),
  name, cost, and shortcut key (`1`-`9`, `0`, `E`). An unaffordable entry is dimmed.
  The armed entry is highlighted.
- **Selected-structure panel:** when a friendly structure is selected, its **name**
  plus the fields that apply to it. The **base** and **Reliquary** show their **health**
  (current/max HP), read-only — the Reliquary's panel may also note its `4 HP/s` regen
  (`specs/waves.md`) — with no level or actions. A **build-grid structure** (spawner or
  Solar Extractor) shows its **level** pips, current effect, and the Upgrade/Sell
  actions with their sol figures; these sit safely off the lane and are not damageable,
  so they carry no health readout.
- **Performance overlay** — a toggle (default off, bound to a key — e.g. `F3`)
  showing at least the live **FPS**, so the required frame rate
  (`specs/overview.md`) is observable during a heavy late-match battle. Keep it
  small, in a corner, in the faint/secondary text colors.
- **Wireframe mode** — a toggle (default off, bound to a key — e.g. `F4`) that
  switches the units, structures, terrain, and generated effects to **wireframe** so
  the 3D geometry is inspectable (`specs/overview.md`). Toggling it must not disturb
  the simulation.
- Units and structures show a **health bar** above them in the world only while damaged
  (`specs/overview.md`).

Keep every HUD element on screen and legible at all window sizes; the camera shows a
scrollable portion of the battlefield — the full lane width but never the whole arena
at once (`specs/overview.md`).

## The AI opponent

The match is one human (left) against one AI (right). The AI must be a real
opponent, not a scripted script:

- It runs the **same economy** with **no cheating** (`specs/economy.md`): same
  starting sol, same fixed base income rate, same Solar Extractor rules, same costs.
  It spends only sol it has earned.
- It **builds and upgrades spawners and Solar Extractors on its own hidden grid**,
  growing its army and income over the match, and **adapts its composition** to what
  it has seen of your army — answering a swarm with splash, heavies with piercing,
  air with flak — so a one-note strategy from the player loses to the counter. It
  need not have perfect information; like you, it reacts to what crosses the sand.
- It defends and presses: it values taking your Reliquary and defends its own,
  and it commits its Aegis when it gets one.
- It must be **clearly beatable** by a thinking player — a well-read composition,
  a timely Reliquary push, or a better economy beats it. It is competent, not
  omniscient, and not a resource-cheating wall. Tune it so a first-time player can
  lose but a player who understands the counters can win.

## Out of scope

- Network or online multiplayer (the opponent is the local AI only).
- More than two sides, or more than one lane.
- A tech tree, hero units, or abilities beyond the roster in `specs/units.md`.
- Terrain the player edits, destructible cover, or unit micro-control — the player
  commands the economy and composition, never an individual unit's movement.
- Persistence of progress or settings between sessions.
