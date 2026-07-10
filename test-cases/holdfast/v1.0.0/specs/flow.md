# Holdfast — Survival, days, scoring, states, and HUD

This file defines the shape of a game: the survival pressure that drives it, the day
count, scoring, the loss state, the game's state machine, the HUD dashboard, audio, the
behaviors that make good test targets, and what is out of scope. It refers to the tile
world (`specs/world.md`), the settlers (`specs/settlers.md`), the economy
(`specs/economy.md`), combat (`specs/combat.md`), the day/night cycle (`specs/time.md`),
the controls (`specs/controls.md`), and the modes under `specs/modes/`.

## Survival pressure

Holdfast is a **survival** game: there is no victory screen to reach, only how long the
colony endures. The pressure comes from the raids and the needs:

- **The raids escalate.** The threat director (`specs/combat.md`) sends bigger, stronger
  raids as the colony ages and grows richer, on a tightening timer. With nothing built,
  a colony is overrun quickly; it must stand up **walls, cover, turrets, and armed
  defenders** and keep its people fed and rested to fight — and it must keep doing so as
  the raids outgrow last defenses.
- **The colony must feed and rest itself.** Settlers get hungry and tired
  (`specs/settlers.md`), so the colony must **build and tend a farm and a stove** for
  meals (`specs/economy.md`) and **beds** for rest before its starting provisions (if
  any) run out, or the crew starves, breaks down in mood, and fights badly.
- **Everything costs labor and time.** Building any of that requires chopping, mining,
  hauling, and settler work (`specs/economy.md`), all while the day/night clock and the
  raid timer run (`specs/time.md`, `specs/combat.md`) — so the opening days are a
  scramble to get walls and food up before the first raids, and the later game is
  holding a growing colony together against attacks that never stop growing.

Tune the starting stocks, the needs, and the raid curve so a competent player can meet
the early raids and build a working colony, and a careless one loses it — the pressure
should be real but survivable. The **Siegeworks** start (`specs/modes/`) presses the
threat harder.

## Days and scoring

- **Day count.** Time is measured in **days** (`specs/time.md`). The current day is
  shown in the HUD; it is the colony's age and the game's primary measure of success.
- **Score.** The run's score is chiefly **days survived** (how long the colony lasted
  before it was lost), and may add secondary measures you choose — living settlers,
  raids repelled, raiders killed, structures built — shown at the loss screen. Scores
  are **not persisted** between sessions.
- **Milestones (optional).** You may surface short milestones (first turret online,
  first raid repelled, N days survived) as brief, non-blocking notifications; they are
  flavor, not required.

## The loss state

The colony is **lost** when the **last settler dies** — every settler has been killed,
bled out (`specs/combat.md`), or starved (`specs/settlers.md`). At that point the game
enters the **colony-lost** state (below): it shows the **days survived** and any
secondary tally, and offers a restart. There is no other end; survival is open-ended
until the colony falls.

## Game states

The game is a small state machine. Each state has a clear screen and controls (controls
are defined in `specs/controls.md`).

1. **Title / main menu.** Shows the title `HOLDFAST`, a tagline, and a vertical menu
   listing the playable starts defined by the mode specs (each mode spec declares its
   own entry), followed by `HOW TO PLAY`. The selected item is highlighted. A dim slice
   of a top-down colony may show behind the menu for atmosphere.
2. **How to play.** Describes the controls, the gather→build→cook→defend loop, the
   settlers and their needs and mood, the work-priority grid, the raids and cover, the
   day/night cycle, and the goal (survive as long as possible). Returns to the menu.
3. **In colony.** The live game: the top-down world under the camera, the settlers
   working, the structures and turrets, raids when they come, and the full HUD
   dashboard. The colony sim runs at the current speed, or frozen while paused
   (`specs/controls.md`).
4. **Paused.** The `Esc` overlay menu, reachable from the colony. Offers **Resume**,
   **Restart**, and **Quit to menu**. The field is visible but frozen behind the menu.
   (This is distinct from the in-place speed pause in `specs/controls.md`.)
5. **Colony lost.** Shown when the last settler dies. Displays the **days survived** and
   any secondary tally, with **RESTART** (or **TRY AGAIN**) and **MENU**.

## HUD

The HUD is a **colony dashboard**, drawn in code (`specs/assets.md`; only its small
icons may be produced sprites). It occupies the strips above and below the colony view
(`specs/overview.md`) and is always fully visible.

- **Top strip** (`y` in `[0, 64]`): the colony vitals — the **resource stocks** (wood,
  ore, crops, meals; `specs/economy.md`), a read of the colony's overall state (living
  settlers, and whether anyone is hungry, exhausted, or low), the **day and time-of-day
  clock** and current **speed** (`specs/time.md`, `specs/controls.md`), and — most
  prominently — the **threat / raid warning** when a raid is incoming or underway
  (`specs/combat.md`), surfaced as a clear alert.
- **Bottom strip** (`y` in `[656, 720]`): the **settler roster** — one entry per living
  settler showing its needs and mood at a glance (hunger, rest, mood, health, and what
  it is doing; `specs/settlers.md`) — toward the left, and the **build palette / tool
  bar** — the designate, build (with the structures), and cancel tools
  (`specs/controls.md`) — toward the right. The **work-priority grid**
  (`specs/controls.md`) is opened from here as a panel.

The dashboard must let a player read the colony's health without hunting: what is in the
stores, whether a raid is coming, whether anyone is hungry, hurt, or breaking, and what
the crew is doing.

## Audio

Audio is recommended and, unlike an ordinary end-to-end case, its **assets are part of
what this case tests** (`specs/assets.md`): the sound effects and the music bed are
**produced with the on-`PATH` audio tools**, not synthesized ad hoc or downloaded. It
must still never be required for the game to run or load, must **not** autostart before
the player interacts (browsers block autoplay), and must offer a **mute** toggle. Play
the produced clips via Web Audio: short cues for a **gunshot**, a **hit/impact**, a
**build/place**, and a **raid alarm**, and an **ambient/tension music bed** underneath
that lifts when a raid lands. `specs/assets.md` is the contract for producing and wiring
them.

## Key behaviors

The game must exhibit these behaviors. They are observable and make good test targets:

- Designating a **chop** or **mine** marks a node; a settler walks to it, works it over
  a kind-dependent time, the node **clears** and yields its resource, and **construction/
  impact dust** puffs (`specs/world.md`).
- Settlers have **needs and mood**, **skills**, pull **jobs from a priority queue** set
  by the **work-priority grid**, and **pathfind** across walkable tiles; they eat, sleep,
  and drop everything to fight (`specs/settlers.md`).
- The colony **builds** placed orders from **wood and ore**, **grows and cooks** food
  into meals, and **eats** them (`specs/economy.md`).
- An escalating **threat director** sends **raids**; combat is **ranged** with **cover**
  behind walls, **turrets** fire on their own, and a downed settler **bleeds out** unless
  **tended** (`specs/combat.md`).
- A **day/night cycle** turns; settlers rest at night and raids favor the dark
  (`specs/time.md`).
- The **starting provisions run down** and the **raids grow**, so the colony must build
  faster than it is pressed; when the **last settler dies** the colony is **lost** (this
  file).
- The **settler and raider animations**, the **terrain/structure sprites**, the **combat
  and construction particle effects**, and the **audio** are all **produced with the
  on-`PATH` tools** and wired in (`specs/assets.md`).

## Out of scope

- Network or online multiplayer.
- Touch or gamepad input (keyboard and mouse only for this version).
- Direct control of a settler (you command the colony; settlers are autonomous,
  `specs/settlers.md`).
- Temperature, disease, complex health models, research trees, trade, or other
  simulations beyond the tile world, settlers, the build/food economy, the day/night
  cycle, and the ranged-raid combat specified here — keep the scope to the systems
  above, done well.
- Persistence of colonies, scores, or settings between sessions.
