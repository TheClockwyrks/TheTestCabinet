# Thunderhead — Game flow: states, controls, HUD, and scope

This file defines the shell the game runs inside: the **state machine**, the
**controls** at both scales, the **HUD** and its overlays, audio, and what is **out
of scope**. It ties together the command and possession model (`specs/command.md`),
the combat read-outs (`specs/combat.md`), the fog of war (`specs/recon.md`), and the
battle setup and result (`specs/battle.md`). The palette, type, and states are from
`specs/overview.md`.

## Game states

The build is a state machine. Every state must be reachable and behave as described;
the **title** is shown on load.

- **Title** — the `THUNDERHEAD` title with **PLAY** and **HOW TO PLAY**
  (`specs/overview.md`).
- **How to play** — a readable controls and rules screen reached from the title and
  returnable from it.
- **Deploy** — reached from PLAY: choose the battle (below), then begin.
- **In battle** — the game proper: the tactical command layer and possession
  (`specs/command.md`), run until a flagship falls.
- **Paused** — an overlay that **freezes the simulation** and offers resume, restart,
  and quit to title.
- **Victory** and **Defeat** — the two end screens (`specs/battle.md`), each showing
  the result and the run's stats, with options to play again (to Deploy) or return to
  the title.

## The deploy screen

The deploy screen sets up a battle (`specs/battle.md`):

- **Your power** — choose **Ironbound**, **Meridian**, or **Geode**
  (`specs/factions.md`), shown with each power's identity and color.
- **Opponent** — choose an opposing power or **random** (a mirror of your own power is
  allowed).
- A **Begin** action generates the world and starts the battle.

## Controls

The game is played with **mouse and keyboard**. The bindings below are the intended
scheme (tunable, but all functions must be present and shown on the how-to screen).

### Tactical command layer

- **Camera** — **pan** (edge-scroll or a drag/keys), **rotate** around vertical, and
  **zoom** (`specs/command.md`, `specs/overview.md`).
- **Select** — click a unit, drag a box for many; **control groups** on number keys.
- **Order** — issue **Move**, **Attack**, **Escort**, **Hold**, **Patrol**,
  **Stance**, **Altitude**, and **Air operations** to the selection (`specs/command.md`);
  a right-click context order on the terrain/target is the expected default.
- **Possess** — take direct control of the selected unit.
- **Game speed** — pause and one or more fast-forward speeds; the simulation stays
  frame-rate independent at each (`specs/overview.md`).

### Possessing a unit

- **Move (always active)** — **`W`/`S`** throttle/speed, **`A`/`D`** rudder/turn;
  aircraft also climb/dive and bank on these; a **submarine** also controls **depth**
  and toggles **silent-running** (`specs/command.md`, `specs/units.md`). Any movement
  input disconnects the autopilot (`specs/command.md`).
- **Aim/look** — the **mouse**; **fire** — the primary mouse button at a weapon
  station.
- **Man a station** — switch among the unit's stations (a cycle key and/or direct
  keys): a ship's **weapon class**, a **bomber turret**, or a **special station**
  (`specs/units.md`); drop back to **just steering** with no station manned.
- **Fire mode** — toggle **salvo** / **ripple** for a ship's guns (`specs/combat.md`).
- **Blink** — a **Meridian aircraft** only, on its own key, subject to its charge and
  cooldown (`specs/combat.md`).
- **Release** — return to the tactical view (the unit resumes its order;
  `specs/command.md`); a **possess-next** binding jumps directly to another unit.

## The HUD

The HUD is drawn in the palette and monospace type of `specs/overview.md`. It has two
faces, matching the two scales.

### Tactical HUD

- **Fleet roster** — your units, their type and health, with quick-select; losses
  fall off.
- **Flagships** — the health of **your** flagship and, once detected, the **enemy**
  flagship — the two bars that decide the battle (`specs/battle.md`).
- **Requisition** — the current pool and **income**, and the **reinforcement** call
  UI and its arrival timers (`specs/battle.md`).
- **Selection / order panel** — the current selection and its standing order, with the
  orders available.
- **Minimap / contacts** — the battlespace overview with friendly units and detected
  **contacts** (`specs/recon.md`), the deployment zones, and the camera's location.
- **Alerts** — concise notices (a unit under attack, the flagship in danger,
  reinforcements arrived).

### Direct-control HUD

- **Possessed unit & station** — which unit you have and which **station** is manned
  (or "steering"), with a **station-switch** indicator of the others available.
- **Gunnery read-out** — at a ship weapon class, the **per-turret status indicators**
  (green ready / amber reloading with a clock-like sweep / red unavailable) as a ring
  of small dots **around the crosshair** — main guns above, secondary below — plus the
  current **fire mode** (`specs/combat.md`).
- **Movement** — speed/throttle and heading; **altitude** for aircraft, **depth** for
  a submarine.
- **Condition** — the unit's **health**, its **shield** (Meridian) or **resonance**
  state (Geode) or **damage-control** state (Ironbound: fires, breaches, crew;
  `specs/combat.md`), and its **ordnance/ammo** where it matters (torpedoes, bombs).
- **Blink charge** — for a Meridian aircraft (`specs/combat.md`).

### Overlays

- **Performance overlay** — a toggle that shows the live **FPS**, so the frame-rate
  requirement is observable (`specs/overview.md`).
- **Wireframe** — a toggle that switches the **terrain** and the **unit models** to
  wireframe (`specs/overview.md`).

## Audio

Audio is **required** and must be **synthesized in code** (e.g. the Web Audio API) —
no downloaded audio files. Gunfire, engines, torpedo runs, alerts, and the
end-of-battle stinger are the natural cues. The game must remain fully playable with
sound off and must never fail to run or load if audio cannot start.

## Out of scope

To keep the build focused, the following are **not** required and should not displace
the core game:

- **no campaign or scripted missions** — the game is the generated skirmish battle
  (`specs/battle.md`);
- **no multiplayer or networking** — the opponent is the AI (`specs/battle.md`), and
  the whole game runs locally with no backend (`specs/overview.md`);
- **no persistent progression, unlocks, or economy** between battles;
- **no terrain deformation or base-building** — the world is fixed at generation
  (`specs/world.md`) and a fleet is commanded, not constructed on the map;
- **no character models or crew avatars** — every unit is a rigid machine
  (`specs/overview.md`, `specs/assets.md`).
