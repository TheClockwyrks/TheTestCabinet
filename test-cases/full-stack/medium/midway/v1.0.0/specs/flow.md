# Midway — Reputation, days, scoring, states, and HUD

This file defines the shape of a game: the reputation feedback loop that drives it,
the day clock, scoring, the loss state, the game's state machine, the HUD
dashboard, audio, the behaviors that make good test targets, and what is out of
scope. It refers to the park grid (`specs/park.md`), the guests (`specs/guests.md`),
the rides and stalls (`specs/rides.md`), the economy (`specs/economy.md`), the staff
(`specs/staff.md`), the controls (`specs/controls.md`), and the start in
`specs/mode.md`.

## The reputation feedback loop

Midway is a **management** game: there is no victory screen, only how long and how
well the park runs before it goes broke. Its engine is a **feedback loop**, and it
must be a real loop the player can see turning:

- **Rating.** The park has a **rating** (stars, or a 0–100 score — your choice) that
  reflects how good a place it is: it rises with the crowd's **average happiness**
  (`specs/guests.md`), a **clean** park (low litter, `specs/staff.md`), and good ride
  **variety and reliability** (`specs/rides.md`), and falls with unhappy guests, filth,
  breakdowns, and bad reviews from guests leaving angry.
- **Arrivals follow rating.** The **guest arrival rate** at the gate is **driven by
  the rating** (`specs/guests.md`): a high rating brings a growing stream, a low one
  dwindles to nothing. This closes the loop — happiness lifts rating, rating lifts
  arrivals, arrivals (spending well) fund a better park that keeps guests happy.
- **The loop runs both ways.** Let the park slide — overprice it, let rides break and
  litter pile up — and happiness falls, the rating drops, arrivals dry up, income
  falls below upkeep and wages, and the park spirals toward bankruptcy
  (`specs/economy.md`). The player's whole job is keeping the loop spinning the right
  way.

Balance the loop so a competent player can grow a self-sustaining park and a careless or
greedy one watches it spiral. The active start (`specs/mode.md`) sets the conditions
the loop runs under.

## Days and scoring

- **Day clock.** Time is measured in **days** — a fixed span of simulation time. The
  current day is shown in the HUD; it is the park's age and a primary measure of the
  run. (You may layer a finer clock or an open/close cycle within a day;
  keep it legible.)
- **Score.** The run's score is chiefly **days operated** and the park it built —
  **peak guests**, **park rating**, **total profit** — shown at the park-closed screen.
  You may add secondary measures you choose. Scores are **not persisted** between
  sessions.
- **Milestones.** Surface short milestones (first ride open, first
  5-star day, N guests at once, N days operated) as brief, non-blocking notifications.

## The loss state

The park is **lost** when it goes **bankrupt** — cash below the bankruptcy floor past
the grace period (`specs/economy.md`). At that point the game enters the
**park-closed** state (below): it shows the **days operated** and the secondary tally
(peak guests, rating, profit), and offers a restart. There is no other end; the park
runs open-ended until it goes broke.

## Game states

The game is a small state machine. Each state has a clear screen and controls
(controls are defined in `specs/controls.md`).

1. **Title / main menu.** Shows the title `MIDWAY`, a tagline, and a vertical menu
   listing the playable start defined by `specs/mode.md` (it declares its own menu
   entry), followed by `HOW TO PLAY`. The selected item is highlighted. A dim
   slice of a lively park may show behind the menu for atmosphere.
2. **How to play.** Describes the controls, the build-paths→place-rides→price→staff
   loop, the guests and their desires, the reputation-and-arrivals feedback, and the
   goal (grow the park and keep it solvent). Returns to the menu.
3. **In park.** The live game: the tile park under the camera, the guests and staff at
   work, the rides running and queuing, and the full HUD dashboard. The sim runs at
   the current speed, or frozen while paused (`specs/controls.md`).
4. **Paused.** The `Esc` overlay menu, reachable from the park. Offers **Resume**,
   **Restart**, and **Quit to menu**. The park is visible but frozen behind the menu.
   (This is distinct from the in-place speed pause in `specs/controls.md`.)
5. **Park closed.** Shown when the park goes bankrupt. Displays the **days operated**
   and the secondary tally, with **RESTART** (or **TRY AGAIN**) and **MENU**.

## HUD

The HUD is a **park dashboard**, drawn in code (`specs/assets.md`; only its small
icons may be produced sprites). It occupies the strips above and below the park view
(`specs/overview.md`) and is always fully visible.

- **Top strip** (`y` in `[0, 64]`): the park vitals — the **cash balance** with its
  **income/expense** trend (`specs/economy.md`), the current **guest count**, the park
  **rating** (stars/score), the crowd's **average happiness** (`specs/guests.md`), and
  the **day** and current **speed** (`specs/controls.md`). Prominent **alerts** — a ride
  broken, litter high, cash low — surface here.
- **Bottom strip** (`y` in `[656, 720]`): the **build palette / tool bar** — the path,
  build (with the rides, stalls, and scenery), staff, price/manage, and demolish tools
  (`specs/controls.md`) — toward the left, and a **context panel** toward the right
  that shows the selected tool's options or the selected object's details: an
  attraction's price, queue, and takings; a guest's desires and mood; or the staff
  roster and wage bill (`specs/rides.md`, `specs/guests.md`, `specs/staff.md`).

The dashboard must let a player read the park's health without hunting: whether it is
making money, whether the crowd is happy, how it is rated, and what needs attention
right now.

## Audio

Audio is recommended and, unlike an ordinary end-to-end case, its **assets are part
of what this build is about** (`specs/assets.md`): the sound effects and the music bed are
**produced with the on-`PATH` audio tools**, not synthesized ad hoc or downloaded. It
must still never be required for the game to run or load, must **not** autostart
before the player interacts (browsers block autoplay), and must offer a **mute**
toggle. Play the produced clips via Web Audio: short cues for a **purchase/coin**, a
**ride ding**, and a **low-cash / ride-broken alarm**, a soft **crowd** or
ride hum, and a cheerful **carnival music bed** underneath. `specs/assets.md` is the
contract for producing and wiring them.

## Key behaviors

The game must exhibit these behaviors. They are observable and make good test targets:

- The player **lays path** from the gate and **places** a ride/stall on grass with its
  entrance on that path; only then do guests reach it (`specs/park.md`,
  `specs/rides.md`).
- **Guests** enter at the gate paying admission, act on their **desires**, pathfind the
  paths, **queue and ride**, **buy** from stalls, **rest**, and **leave** happy or
  angry (`specs/guests.md`).
- A ride **loads to capacity, runs, and unloads**, its **queue** growing when
  throughput is short; a ride **breaks down** and a **mechanic** repairs it
  (`specs/rides.md`, `specs/staff.md`).
- **Litter** builds on the paths and a **janitor** clears it; an **entertainer** lifts
  nearby mood (`specs/staff.md`).
- **Prices** the player sets change guest spending and happiness; the **budget** rises
  and falls with income, upkeep, and wages, and can go into the red (`specs/economy.md`).
- The park **rating** tracks happiness and cleanliness and **drives the arrival rate**;
  a neglected park spirals to **bankruptcy** and the **park-closed** loss state (this
  file).
- The **guest and ride animations**, the **path/ride/stall/scenery sprites**, the
  **particle effects**, and the **audio** are all **produced with the on-`PATH` tools**
  and wired in (`specs/assets.md`).

## Out of scope

- Network or online multiplayer.
- Touch or gamepad input (keyboard and mouse only for this version).
- Direct control of a guest or staff member (you shape the park; they are autonomous,
  `specs/guests.md`, `specs/staff.md`).
- A full coaster-track construction editor, terrain height/terraforming, or seasons or
  research trees beyond what the specs describe — keep the scope to the park, guests,
  rides/stalls, economy, staff, and reputation loop specified here, plus whatever the
  active start (`specs/mode.md`) defines, done well.
- Persistence of parks, scores, or settings between sessions.
