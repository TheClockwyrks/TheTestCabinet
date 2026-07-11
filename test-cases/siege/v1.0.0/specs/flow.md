# Siege — Flow, states, controls, and HUD

This file defines the game-state machine, the title and in-game screens, the
controls, and the HUD. It refers to the world in `specs/world.md`, the survival
loop in
`specs/phases.md`, the classes and roster in `specs/combat.md`, and the AI in
`specs/ai.md`. Use the palette and monospace type from `specs/overview.md`
throughout.

## The siege ends — losing

There is no winning (`specs/phases.md`). A siege ends the instant **redoubt C
falls**, going to the **defeat** state showing the run's survival time and kills.

## Game states

The build is a small state machine. Each state has a clear screen and controls.

1. **Title.** The screen shown **on load**. It presents the game title `SIEGE`, a
   tagline, and exactly two options:
   - **PLAY** — starts a new siege. It first opens the **starting-phase** prompt
     (below), then drops the player into the game.
   - **HOW TO PLAY** — opens a controls/how-to screen (below), from which the
     player returns to the title.
   No class or phase is chosen here — those come later. This screen is **static on
   load** (it does not animate a live world behind it in a way that changes what a
   screenshot shows), so it is the deterministic view the harness checks.
2. **Starting-phase prompt.** Reached from **PLAY**. Offers **A**, **B**, or **C**
   (`specs/phases.md`), with A the default and a short note that B and C drop
   straight into the tougher later assault. Confirming a phase enters the siege at
   that phase; a back/cancel returns to the title.
3. **How to play.** Reached from **HOW TO PLAY**. A static panel listing the
   controls (below) and a brief primer on the loop — the classes and their
   loadouts (`specs/combat.md`), that you pick your class when you spawn, the medic
   heals and the engineer resupplies, and that the siege is a fighting retreat you
   cannot win. Returns to the title.
4. **In siege.** The live first-person game on the world from `specs/world.md`:
   you and your squad defending the active redoubt, the Scourge assaulting, the
   HUD below. This is where `specs/world.md`, `specs/phases.md`, `specs/combat.md`,
   and `specs/ai.md` play out. It includes the **spawn UI**:
   - Whenever the player is waiting to (re)enter the fight — on the first deploy of
     a siege and again during each **respawn** delay after death (`specs/phases.md`)
     — a **spawn overlay** lets the player pick their **class** (the three from
     `specs/combat.md`: **Ranger**, **Marksman**, **Breacher**), each with a
     one-line loadout description, and a **DEPLOY** control to confirm and spawn.
     The class may be **changed on every respawn**, so a player can adapt to the
     assault. The world is visible behind the overlay; the survival clock keeps
     counting (dying costs the defense — `specs/phases.md`).
   - Entering the live fight (after DEPLOY) engages pointer lock (below).
5. **Paused.** Reachable from the siege (`Esc`). Offers **Resume**, **Restart**,
   and **Quit to title**. The world is visible but the **simulation and the
   survival clock are frozen** behind the menu, and pointer lock is released.
6. **Defeat.** Shown when redoubt C falls. Displays `THE LINE HAS FALLEN` (or
   similar), the **survival time** reached and the **total kills**, with
   **REDEPLOY** (back to the title) and **DEPLOY AGAIN** (restart a fresh siege at
   the same starting phase). See `reference/game-over.png`.

Every state must be reachable and behave as described.

## Controls

The siege is a first-person shooter driven by mouse-look and the keyboard; menus
accept mouse and keyboard.

- **Look:** mouse, via the browser **Pointer Lock API** — entering the siege locks
  the pointer; `Esc` (pause) releases it. Clicking the world re-locks it. Look
  must be smooth and frame-rate independent.
- **Move:** `W`/`A`/`S`/`D`; **sprint** `Shift`; **crouch** `Ctrl` or `C`; **jump**
  `Space` (`specs/combat.md`).
- **Fire:** left mouse (primary). **Aim down sights:** right mouse. **Reload:**
  `R`. **Grenade:** `G`. **Swap primary/secondary:** `Q`, the scroll wheel, or
  `1`/`2`.
- **Pause:** `Esc`.
- **Toggles** (see HUD): **performance overlay** and **wireframe mode** each have a
  key (state them on the how-to line or a controls hint — e.g. `F3` performance,
  `F4` wireframe); both work during a live siege.
- **Menus / title / phase prompt / spawn UI / pause / defeat:** the mouse selects
  and clicks; arrow keys or `W`/`S`/`A`/`D` move the selection and `Enter`/`Space`
  confirms. The starting-phase prompt selects a phase; the spawn UI selects a class.

A brief controls hint must be available (on the title screen, the **HOW TO PLAY**
screen, and/or a pause-menu panel) so a first-time player can find these.

## HUD

Drawn as a first-person overlay in the palette and monospace type from
`specs/overview.md`, over the 3D view. All HUD elements must stay on screen,
fitted and legible, at any window size and pixel density, including on load. The
HUD shows, at minimum:

- **Crosshair** at screen center, reflecting the equipped weapon; a hitmarker on
  landing a hit is welcome.
- **Health** — the player's HP (`specs/combat.md`), as a number and/or bar,
  filling healthy → critical by fraction.
- **Ammo** — the equipped weapon's **magazine / reserve** (`specs/combat.md`) and
  the **grenade** count, in the ammo/accent color; a reload indicator.
- **Survival clock** — the count-up `M:SS` timer (`specs/phases.md`), prominent.
- **Kills** — the running kill counter (`specs/phases.md`).
- **Redoubt status** — which redoubt is active (`DEFENDING A` / `B` / `C`) and its
  **health bar** (`specs/world.md`), so the player can watch the objective being
  ground down. A brief callout when a redoubt falls and the front falls back.
- **Squad panel** — the four squad members (`specs/ai.md`) — Rifleman, Machine
  Gunner, Medic, Engineer — each shown **alive** with a health bar (rifleman and
  gunner in Cobalt, medic in Teal, engineer in the ammo/accent color) **or dead**
  with a **respawn countdown**. Required, so the player can read the squad at a
  glance.
- **Artillery telegraphs** — the ground rings for incoming shells
  (`specs/combat.md`) are drawn in the world (not the flat HUD), warning then
  imminent; a directional cue on the HUD for a shell targeting the player is
  **required**.
- **Respawn overlay** — while the player is dead, a countdown to respawn
  (`specs/phases.md`).

### Performance overlay

A toggleable **performance overlay** (default off, bound to a key — e.g. `F3`)
shows at least the live **FPS**, and ideally the **draw count** and on-screen unit
count. It exists so the required frame rate (`specs/overview.md`) is observable
during a heavy phase-C assault. Keep it small, in a corner, in the faint/secondary
text colors.

### Wireframe mode

A toggleable **wireframe mode** (default off, bound to a key — e.g. `F4`) renders
the scene as wireframe — **both** the terrain **and** the character/weapon
geometry — so the generated geometry (the terrain mesh and the blocky models) can
be inspected. Toggling it must not disturb the simulation.

## Audio

Audio is **required**: synthesize it with the Web Audio API (no audio files) —
short distinct cues for firing, reloading, a hit, an artillery shell incoming and
landing, a redoubt falling, a medic heal, and the defeat sting. The game must
still remain fully playable with sound muted and must never fail to run or load
if audio cannot start. Provide a mute toggle, and do not start audio until the
player interacts (browsers block autoplay).

## Out of scope

- Network or online multiplayer — the squad and the Scourge are all local AI.
- Destructible or editable terrain (`specs/world.md`), building/placing structures,
  or vehicles.
- A win condition, campaign, levels beyond the three redoubts, or persistence of
  progress or settings between sessions.
- Additional classes, weapons, or Scourge archetypes beyond those in
  `specs/combat.md` — escalation is by tier and cadence (`specs/phases.md`), not a
  larger roster.
- Inventory, looting, or health/ammo pickups — healing is medic-only and
  reserve-ammo resupply is engineer-only (`specs/ai.md`); ammo is otherwise managed
  by reloading from reserve (`specs/combat.md`).
