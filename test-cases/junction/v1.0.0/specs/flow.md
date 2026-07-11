# Junction — Growth, solvency, scoring, states, and HUD

This file defines the shape of a game: the pressure that drives it, the clock, scoring,
the bankruptcy loss state, the game's state machine, the HUD dashboard, audio, the
behaviors that make good test targets, and what is out of scope. It refers to the map
(`specs/map.md`), transit (`specs/transit.md`), utilities (`specs/utilities.md`), the
economy (`specs/economy.md`), the controls (`specs/controls.md`), and the modes under
`specs/modes/`.

## The pressure

Junction is an **open-ended builder**: there is no victory screen to reach, only how
large and how prosperous a city you can grow and hold. The pressure is the pull between
**growth** and **solvency**:

- **Grow, and it costs.** Meeting demand (`specs/economy.md`) means zoning land and,
  crucially, **paying to connect and serve it** — roads, rail, wires, pipes, plants —
  each of which is a capital cost now and **upkeep forever after**
  (`specs/transit.md`, `specs/utilities.md`, `specs/economy.md`). Grow faster than the
  tax base can carry, and the budget slides into the red.
- **Don't grow, and it stalls.** A city that stops growing still pays upkeep, and its
  fixed costs eventually outrun a static tax base — while unmet demand and the systems
  fighting each other (congestion capping growth, pollution suppressing land value)
  mean growth is never automatic.
- **Keep it flowing.** Every neighborhood added loads the roads (`specs/transit.md`) and
  draws on the utilities (`specs/utilities.md`); let the roads gridlock or a network
  over-draw and the city stops developing and starts to abandon, shrinking the tax base
  just when you need it. Holding traffic, services, pollution, and the budget in balance
  as the city grows **is** the game.

Tune the demand, costs, and upkeep so a competent player grows a healthy, solvent city
and a careless one slides toward bankruptcy — the pressure should be real but
recoverable. The `roughterrain` start (`specs/modes/`) tightens the opening by making
the land costlier to build across.

## Clock and scoring

- **Clock.** Time is measured on a **city clock** — a readable in-game date or period
  count (e.g. months/years) shown in the HUD; the **budget period** (`specs/economy.md`)
  is settled on its beat. It is the city's age and paces the whole simulation.
- **Score.** The run's standing is chiefly the city's **peak population** and how long
  it stayed solvent, and may add secondary measures you choose — treasury, developed
  tiles, prosperity/land value — shown at the bankruptcy screen. Scores are **not
  persisted** between sessions.
- **Milestones (optional).** You may surface short milestones (first rail line, N
  population reached, a district maxed out) as brief, non-blocking notifications with a
  **fireworks** flourish (`specs/assets.md`); they are flavor, not required.

## The loss state

The city is **lost to bankruptcy** when the treasury has stayed **insolvent past the
debt limit** (`specs/economy.md`) — out of credit and still losing money — with no
recovery. At that point the game enters the **bankruptcy** state (below): it shows the
**final tally** (peak population, the date/periods survived, and any secondary score)
and offers a restart. There is no other end; the city runs open-ended until it goes
broke.

## Game states

The game is a small state machine. Each state has a clear screen and controls
(controls are defined in `specs/controls.md`).

1. **Title / main menu.** Shows the title `JUNCTION`, a tagline, and a vertical menu
   listing the playable starts defined by the mode specs (each mode spec declares its
   own entry), followed by `HOW TO PLAY`. The selected item is highlighted. A dim slice
   of a top-down city may show behind the menu for atmosphere.
2. **How to play.** Describes the controls, the zone→connect→serve→develop loop, the RCI
   demand, the transit-and-congestion flow, power and water, the budget and how a city
   goes bankrupt, and the goal (grow a large, solvent city). Returns to the menu.
3. **In city.** The live game: the tile map under the camera, the developed city, the
   traffic and vehicles, the overlays, and the full HUD dashboard. The sim runs at the
   current speed, or frozen while paused (`specs/controls.md`).
4. **Paused.** The `Esc` overlay menu, reachable from the city. Offers **Resume**,
   **Restart**, and **Quit to menu**. The map is visible but frozen behind the menu.
   (This is distinct from the in-place speed pause in `specs/controls.md`.)
5. **Bankruptcy.** Shown when the city goes broke. Displays the **final tally** (peak
   population, periods/date survived, and any secondary score), with **RESTART** (or
   **TRY AGAIN**) and **MENU**.

## HUD

The HUD is a **city dashboard**, drawn in code (`specs/assets.md`; only its small icons
may be produced sprites). It occupies the strips above and below the city view
(`specs/overview.md`) and is always fully visible.

- **Top strip** (`y` in `[0, 64]`): the city vitals — the **treasury** and the
  **per-period balance** (income vs. expenses, sign clear; `specs/economy.md`), the
  **population**, the **power** and **water** supply-vs-demand balances with a clear
  **shortfall** flag (`specs/utilities.md`), and the **clock/date** and current
  **speed** (`specs/controls.md`). A budget or utility **alert** (losing money,
  approaching the debt limit, a network over-drawn) is surfaced prominently here.
- **Bottom strip** (`y` in `[656, 720]`): the **RCI demand meters** — the three
  Residential/Commercial/Industrial demand bars (`specs/economy.md`) — toward the left,
  and the **build palette / tool bar** — the zone, road, rail, station, power, water,
  and bulldoze tools (`specs/controls.md`) — toward the right, with the active tool and
  its cost readout shown.

The dashboard must let a player read the city's health without hunting: whether it is
making or losing money, whether traffic is flowing, whether power and water are met,
which way demand is pushing, and what the active tool will cost.

## Audio

Audio is recommended and, unlike an ordinary end-to-end case, its **assets are part of
what this build is about** (`specs/assets.md`): the sound effects and the music bed are
**produced with the on-`PATH` audio tools**, not synthesized ad hoc or downloaded. It
must still never be required for the game to run or load, must **not** autostart before
the player interacts (browsers block autoplay), and must offer a **mute** toggle. Play
the produced clips via Web Audio: short cues for **building/placing**, a **notification
chime** (a milestone or a completed development), and an **alert** (budget/utility
trouble), and a calm **ambient city music bed** underneath. `specs/assets.md` is the
contract for producing and wiring them.

## Key behaviors

The game must exhibit these behaviors. They are observable and make good test targets:

- **Zoning** buildable land and, once it has **road access** and **power and water**,
  watching it **develop** buildings that grow through **density tiers** with demand —
  and **abandon** when access, service, or demand is lost (`specs/map.md`).
- Citizens and goods **path across** the transit network from homes to jobs and shops;
  links carrying more than their capacity **congest** and slow, shown on the **traffic
  overlay**, and a **rail line** with stations relieves a busy road corridor
  (`specs/transit.md`).
- **Power** and **water** supply **propagate** along wires and pipes; a tile reached by
  both develops, an **unserved or over-drawn** network stalls or abandons its tiles
  (`specs/utilities.md`).
- The **RCI demands** rise and fall with the city and **drive growth**, capped by what
  transit and utilities can carry; **pollution** lowers **land value** and suppresses
  nearby development (`specs/economy.md`).
- A **budget** of tax income vs. upkeep runs each period; an insolvent city driven past
  its **debt limit** goes **bankrupt** — the loss state (this file).
- The **city sprites**, the **animated signal/construction/vehicle sheets**, the
  **pollution/dust/fireworks particle overlays**, and the **audio** are all **produced
  with the on-`PATH` tools** and wired in (`specs/assets.md`).

## Out of scope

- Network or online multiplayer.
- Touch or gamepad input (keyboard and mouse only for this version).
- Terraforming — the player works with the terrain they are given (`specs/map.md`).
- Utilities beyond power and water (no garbage, sewage, education, health, etc.),
  disasters, individually-named citizens, or other simulations beyond the zoned map,
  transit with congestion, the two utilities, and the demand/budget economy specified
  here — keep the scope to the systems above, done well.
- Persistence of cities, scores, or settings between sessions.
