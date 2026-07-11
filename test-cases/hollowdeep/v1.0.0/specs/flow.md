# Hollowdeep — Survival, cycles, scoring, states, and HUD

This file defines the shape of a game: the survival pressure that drives it, the
cycle clock, scoring, the loss state, the game's state machine, the HUD dashboard,
audio, the behaviors that make good test targets, and what is out of scope. It refers
to the tile world (`specs/world.md`), the gas (`specs/gas.md`), power
(`specs/power.md`), the delvers (`specs/delvers.md`), the economy (`specs/economy.md`),
the controls (`specs/controls.md`), and the modes under `specs/modes/`.

## Survival pressure

Hollowdeep is a **survival** game: there is no victory screen to reach, only how long
the colony endures. The pressure comes from the air and the food:

- **The air runs down.** The colony opens with a **finite pocket of breathable
  oxygen** (`specs/gas.md`) and no ambient supply. The delvers breathe it and exhale
  CO2 continuously, so — with nothing built — the pocket sours and the colony
  suffocates within a bounded time. The colony must **build powered oxygen
  generation** (a generator + wiring + an oxygen diffuser, `specs/power.md`) and
  **manage CO2** (walls, pumps, vent space) before that happens.
- **The colony must feed itself.** Delvers get hungry (`specs/delvers.md`), so the
  colony must **build and tend a fungus farm** (`specs/economy.md`) to have food
  before its starting provisions (if any) run out, or the delvers starve.
- **Everything costs labor and time.** Building any of that requires digging ore,
  refining material, and delver work (`specs/economy.md`), all while the clocks run —
  so the opening cycles are a scramble to get life support standing before the pocket
  is spent, and the later game is holding a growing colony's air and food in balance.

Tune the starting air, consumption, and machine output so a competent player can just
get life support up in time and a careless one loses the colony — the pressure should
be real but survivable. The **Deepstart** start (`specs/modes/deepstart.md`) tightens
the opening.

## Cycles and scoring

- **Cycle clock.** Time is measured in **cycles** — a fixed span of simulation time
  (a colony "day"). The current cycle is shown in the HUD; it is the colony's age and
  the game's primary measure of success.
- **Score.** The run's score is chiefly **cycles survived** (how long the colony
  lasted before it was lost), and may add secondary measures you choose — living
  delvers, tiles dug, material or food banked — shown at the loss screen. Scores are
  **not persisted** between sessions.
- **Milestones (optional).** You may surface short milestones (first oxygen diffuser
  online, first harvest, N cycles survived) as brief, non-blocking notifications;
  they are flavor, not required.

## The loss state

The colony is **lost** when the **last delver dies** — every delver has suffocated
(`specs/gas.md`) or starved (`specs/delvers.md`). At that point the game enters the
**colony-lost** state (below): it shows the **cycles survived** and any secondary
tally, and offers a restart. There is no other end; survival is open-ended until the
colony falls.

## Game states

The game is a small state machine. Each state has a clear screen and controls
(controls are defined in `specs/controls.md`).

1. **Title / main menu.** Shows the title `HOLLOWDEEP`, a tagline, and a vertical
   menu listing the playable starts defined by the mode specs (each mode spec
   declares its own entry), followed by `HOW TO PLAY`. The selected item is
   highlighted. A dim slice of a cross-section colony may show behind the menu for
   atmosphere.
2. **How to play.** Describes the controls, the air/CO2 survival loop, the dig→refine→
   build chain, the delvers and their needs, power and the machines, and the goal
   (survive as long as possible). Returns to the menu.
3. **In colony.** The live game: the tile world under the camera, the delvers working,
   the gas overlay, the machines running, and the full HUD dashboard. The colony sim
   runs at the current speed, or frozen while paused (`specs/controls.md`).
4. **Paused.** The `Esc` overlay menu, reachable from the colony. Offers **Resume**,
   **Restart**, and **Quit to menu**. The field is visible but frozen behind the
   menu. (This is distinct from the in-place speed pause in `specs/controls.md`.)
5. **Colony lost.** Shown when the last delver dies. Displays the **cycles survived**
   and any secondary tally, with **RESTART** (or **TRY AGAIN**) and **MENU**.

## HUD

The HUD is a **colony dashboard**, drawn in code (`specs/assets.md`; only its small
icons may be produced sprites). It occupies the strips above and below the colony view
(`specs/overview.md`) and is always fully visible.

- **Top strip** (`y` in `[0, 64]`): the colony vitals — the **average / lowest
  oxygen** and a **CO2** read (so the player sees the air trending), **power** supply
  vs. demand with a clear **brownout** flag (`specs/power.md`), the **resource stocks**
  (ore, material, food; `specs/economy.md`), and the **cycle clock** and current
  **speed** (`specs/controls.md`). A low-oxygen (or starving-colony) **alert** is
  surfaced prominently here.
- **Bottom strip** (`y` in `[656, 720]`): the **delver roster** — one entry per living
  delver showing its needs at a glance (health/oxygen, stamina, hunger, and what it is
  doing; `specs/delvers.md`) — toward the left, and the **build palette / tool bar** —
  the dig, build (with the buildings), and cancel tools (`specs/controls.md`) — toward
  the right.

The dashboard must let a player read the colony's health without hunting: whether the
air is holding, whether power is met, whether anyone is hungry or hurt, and what the
crew is doing.

## Audio

Audio is recommended and, unlike an ordinary end-to-end case, its **assets are part
of what this build is about** (`specs/assets.md`): the sound effects and the music bed are
**produced with the on-`PATH` audio tools**, not synthesized ad hoc or downloaded. It
must still never be required for the game to run or load, must **not** autostart before
the player interacts (browsers block autoplay), and must offer a **mute** toggle. Play
the produced clips via Web Audio: short cues for **digging**, **building/placing**, and
a **low-oxygen alarm**, a soft loop for a **running machine** (optional), and an
**ambient underground music bed** underneath. `specs/assets.md` is the contract for
producing and wiring them.

## Key behaviors

The game must exhibit these behaviors. They are observable and make good test targets:

- Queuing a **dig** marks a tile; a delver walks to it, mines it over a
  kind-dependent time, the tile **opens** and yields its resource, and **dig dust**
  puffs (`specs/world.md`).
- Open tiles hold **oxygen and CO2** that **diffuse** between connected open tiles and
  **settle by weight** (CO2 low, oxygen high); delvers **consume oxygen and exhale
  CO2**, and thin air or heavy CO2 **suffocates** them (`specs/gas.md`).
- **Generators** power **machines** along **wires**; an over-drawn network **browns
  out** and its machines stop; a powered **oxygen diffuser** adds air and a **pump**
  moves gas (`specs/power.md`).
- **Delvers** have **needs**, pull **jobs from a priority queue**, and **pathfind**
  across floors and ladders; they cannot cross open space without a floor or climb
  without a ladder (`specs/delvers.md`).
- The colony **refines ore into material**, **builds** placed orders from it, and
  **farms and eats** fungus (`specs/economy.md`).
- The **starting air depletes**, so the colony must stand up life support before it
  runs out; when the **last delver dies** the colony is **lost** (this file).
- The **gas overlay**, the **delver animations**, the **tile/machine sprites**, and
  the **audio** are all **produced with the on-`PATH` tools** and wired in
  (`specs/assets.md`).

## Out of scope

- Network or online multiplayer.
- Touch or gamepad input (keyboard and mouse only for this version).
- Direct control of a delver (you command the colony; delvers are autonomous,
  `specs/delvers.md`).
- Liquids, temperature, disease, or other simulations beyond the two gases, power,
  and the resource/food loop specified here — keep the scope to the systems above,
  done well.
- Persistence of colonies, scores, or settings between sessions.
