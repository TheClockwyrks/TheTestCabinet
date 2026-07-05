# Siege — Flow, states, controls, and HUD

This file defines the game-state machine, the deploy screen, the controls, and the
HUD. It refers to the world in `specs/world.md`, the survival loop in
`specs/phases.md`, the classes and roster in `specs/combat.md`, and the AI in
`specs/ai.md`. Use the palette and monospace type from `specs/overview.md`
throughout.

## The siege ends — losing

There is no winning (`specs/phases.md`). A siege ends the instant **redoubt C
falls**, going to the **defeat** state showing the run's survival time and kills.

## Game states

The build is a small state machine. Each state has a clear screen and controls.

1. **Deploy (title).** The screen shown **on load**. It presents the game title
   `SIEGE`, a tagline, and two choices plus a confirm:
   - **Class** — the three classes from `specs/combat.md` (**Ranger**,
     **Marksman**, **Breacher**), each with a one-line description of its loadout;
     one is selected/highlighted.
   - **Starting phase** — **A**, **B**, or **C** (`specs/phases.md`), with A the
     default; the selected phase is highlighted, with a short note that B and C
     drop straight into the tougher later assault.
   - **DEPLOY** — begins the siege with the chosen class and phase.
   This screen is **static on load** (it does not animate a live world behind it
   in a way that changes what a screenshot shows), so it is the deterministic view
   the harness checks.
2. **In siege.** The live first-person game on the world from `specs/world.md`:
   you and your squad defending the active redoubt, the Scourge assaulting, the
   HUD below. This is where `specs/world.md`, `specs/phases.md`, `specs/combat.md`,
   and `specs/ai.md` play out. Entering it should engage pointer lock (below).
3. **Paused.** Reachable from the siege (`Esc`). Offers **Resume**, **Restart**,
   and **Quit to deploy**. The world is visible but the **simulation and the
   survival clock are frozen** behind the menu, and pointer lock is released.
4. **Defeat.** Shown when redoubt C falls. Displays `THE LINE HAS FALLEN` (or
   similar), the **survival time** reached, the **phase reached**, and the **total
   kills**, with **REDEPLOY** (back to deploy) and **DEPLOY AGAIN** (restart with
   the same class/phase). See `reference/game-over.png`.

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
- **Menus / deploy / pause / defeat:** the mouse selects and clicks; arrow keys or
  `W`/`S`/`A`/`D` move the selection and `Enter`/`Space` confirms. On the deploy
  screen, class and phase are both selectable.

A brief controls hint must be available (on the deploy screen and/or a pause-menu
panel) so a first-time player can find these.

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
- **Squad panel** — the four squad members (`specs/ai.md`), each shown **alive**
  with a health bar (riflemen in Cobalt, medics in Teal) **or dead** with a
  **respawn countdown**. Required, so the player can read the squad at a glance.
- **Artillery telegraphs** — the ground rings for incoming shells
  (`specs/combat.md`) are drawn in the world (not the flat HUD), warning then
  imminent; an optional directional cue on the HUD for a shell targeting the
  player is welcome.
- **Respawn overlay** — while the player is dead, a countdown to respawn
  (`specs/phases.md`).

### Performance overlay

A toggleable **performance overlay** (default off, bound to a key — e.g. `F3`)
shows at least the live **FPS**, and ideally the visible **chunk/draw count** and
on-screen unit count. It exists so the required frame rate (`specs/overview.md`)
is observable during a heavy phase-C assault. Keep it small, in a corner, in the
faint/secondary text colors.

### Wireframe mode

A toggleable **wireframe mode** (default off, bound to a key — e.g. `F4`) renders
the scene as wireframe — **both** the terrain chunk meshes **and** the
character/weapon geometry — so the generated geometry (the chunk meshing and the
blocky models) can be inspected. Toggling it must not disturb the simulation.

## Audio

Audio is recommended but optional, and must never be required for the game to run
or load. If included, synthesize it with the Web Audio API (no audio files): short
distinct cues for firing, reloading, a hit, an artillery shell incoming and
landing, a redoubt falling, a medic heal, and the defeat sting. Provide a mute
toggle, and do not start audio until the player interacts (browsers block
autoplay).

## Out of scope

- Network or online multiplayer — the squad and the Scourge are all local AI.
- Destructible or editable terrain (`specs/world.md`), building/placing structures,
  or vehicles.
- A win condition, campaign, levels beyond the three redoubts, or persistence of
  progress or settings between sessions.
- Additional classes, weapons, or Scourge archetypes beyond those in
  `specs/combat.md` — escalation is by tier and cadence (`specs/phases.md`), not a
  larger roster.
- Inventory, looting, or health/ammo pickups — healing is medic-only
  (`specs/ai.md`) and ammo is managed by reloading from reserve (`specs/combat.md`).
