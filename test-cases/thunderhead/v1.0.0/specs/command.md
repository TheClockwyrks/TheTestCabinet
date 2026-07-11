# Thunderhead — Command and possession

This file defines how the player controls a fleet at the **two scales** the game is
built on: the **tactical command layer**, where you order your whole fleet from an
overhead view, and **possession**, where you drop into a single unit and fly it,
station by station. It also defines the **cameras and views** each scale uses. The
units and their stations are in `specs/units.md`; what the weapons do when you fire
them is in `specs/combat.md`; what you can see to command is in `specs/recon.md`; the
controls and HUD that front all of this are in `specs/flow.md`.

The player commands **one** fleet; the enemy fleet is run by the AI
(`specs/battle.md`). At every moment the game is running one of these two scales, and
the player moves between them freely.

## The tactical command layer

The default scale is the **tactical command view** — the elevated, orbiting camera
over the battlespace (`specs/overview.md`). From it the player sees the fleet, the
terrain, and whatever the enemy has been detected doing (`specs/recon.md`), and
issues **orders** to units without flying them.

### Selecting

- **Select** a single unit by clicking it, or a **group** by dragging a box or
  adding to the selection. Selection is shown with the allied marker
  (`specs/overview.md`).
- Standard **control groups** may be bound to number keys for quick reselection
  (`specs/flow.md`).

### Orders

An order is given to the current selection and stands until changed or completed. A
unit under an order runs itself — moving, steering, and **auto-firing** its weapons
at valid targets in range (`specs/combat.md`) — until the player changes the order or
**possesses** it. The order set:

- **Move** — go to a point (the unit auto-steers a route there; `specs/world.md`
  channels the route around terrain). For surface ships this is a cloud-top point;
  aircraft and submersibles move in 3D.
- **Attack** — target a specific enemy unit and engage it, maneuvering into weapon
  range and firing (`specs/combat.md`).
- **Escort / follow** — hold station on a friendly unit and defend it.
- **Hold** — stop and hold position, engaging what comes into range.
- **Patrol** — move between points, engaging along the way.
- **Stance** — set how a unit fights while under any of the above: **aggressive**
  (close and engage), **defensive** (hold range, return fire), or **hold fire** (do
  not fire).
- **Altitude** — for units that can change band (`specs/units.md`, `specs/world.md`):
  order a submarine or a surface ship to **dive** (into the murk, to the depth it can
  reach) or **surface** (rise to the cloud-top); order aircraft to a high or low
  cruise.
- **Air operations** — order a **carrier** to **launch** or **recover** aircraft, and
  set what its air wing does (`specs/units.md`, `specs/battle.md`).

Exact key/pointer bindings for issuing orders are in `specs/flow.md`. The
**flagship** takes orders like any unit; losing it still ends the battle
(`specs/battle.md`).

## Possession — taking direct control

At any moment the player may **possess** a unit they own — drop out of the tactical
view and into direct control of that single unit — and later **release** it back to
its standing order. Possession is the game's signature, and it has **two
granularities**: choosing **which unit** you inhabit, and choosing **which station**
you man aboard it.

### Movement is always yours

Whichever station you are in — even none — **you steer the unit**:

- **`A` / `D`** work the **rudder / turn**, **`W` / `S`** the **throttle / speed**; a
  **submarine** also raises and lowers its **depth**, and silent-running is a toggle
  (`specs/units.md`); aircraft bank, climb, and dive on the same movement controls.
- The **mouse** looks around and, when a weapon station is manned, aims and fires it.
- There is **no bridge station** — steering is not something you switch to, it is
  always active while you possess the unit.
- **Autopilot hand-off.** If the unit was under a **Move**/**Attack**/other order, it
  keeps **auto-steering** to carry it out — until the player gives **any** movement
  input, at which point the autopilot **disconnects** and control is fully manual.
  Releasing the unit, or issuing it a fresh order from the tactical view, re-engages
  its automatic steering.

### Manning a station

On top of steering, the player may **man one station** at a time (`specs/units.md`):

- a ship's **weapon class** (surface guns, anti-air, torpedoes) — one crosshair
  commanding that whole class (`specs/combat.md`);
- a **bomber's** single **gun turret** — switched one at a time;
- a **special station** — a carrier's flight operations, an Ironbound ship's
  damage-control, a Meridian carrier's shield-projector, a Geode lodestar's field
  control, a repair tender's repair control, or a submarine's sensors or torpedo
  (`specs/units.md`).

The player **switches stations** freely (a cycle/select binding; `specs/flow.md`) and
may drop back to **just steering** (no station manned). A **fighter** has no station
to switch — possessing it is flight plus its guns.

### What the rest of the unit does

- **Every weapon you are not manning auto-fires** under the unit's AI at valid
  targets — manning the surface guns never silences the anti-air (`specs/units.md`).
- The unit continues to obey **movement** only as you drive it (above); its **other**
  stations fight automatically.
- On **release**, the unit resumes its standing order and every station returns to AI
  — nothing goes dark.

### Switching units

The player can leave one unit and possess another directly (a "possess next unit" /
"possess selected" binding; `specs/flow.md`) or return to the tactical view and pick
a new unit there. Unpossessed units keep carrying out their orders throughout.

## Cameras and views

Each scale has its own view; all must clearly convey a **3D** world
(`specs/overview.md`).

- **Tactical command camera** — an elevated, orbiting view the player can **pan**,
  **rotate** around vertical, and **zoom**. It is a tilted overhead view that keeps
  the relief of the islands and the depth of the cloud sea legible; a straight
  top-down projection does **not** satisfy this requirement (`specs/overview.md`).
- **Steering view (no station manned)** — a chase/free-look view from the possessed
  unit that shows the unit and its surroundings as you drive it.
- **Gunnery view (a ship weapon class)** — an aimed view along the class's crosshair,
  carrying the **per-turret status read-out** (`specs/combat.md`).
- **Flight view (a fighter or a bomber you are flying)** — a cockpit or close-chase
  view for flying; on a bomber, manning a **turret** gives that turret's aimed view
  while you continue to fly.
- **Submarine views** — a dive/steering view in the murk, and the **sensors** view
  (listening / periscope; `specs/recon.md`) and the **torpedo** aiming view.
- **Special-station views** — a view fit to the station: a carrier's flight-operations
  view of its deck and air wing, an Ironbound damage-control view of the ship's
  compartments and crew, a lodestar's field-control view of the resonance web, and so
  on (`specs/units.md`, `specs/combat.md`).

Camera transitions between the tactical view and a possessed unit, and between
stations, should be legible (the player never loses track of what they now control);
the exact transitions are the build's to design.
