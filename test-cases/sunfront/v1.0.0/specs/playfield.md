# Sunfront — The battlefield

This file defines the geometry of the field: the lane where units fight, the two
bases, the two Reliquaries, the staging yards where structures are placed, and
the fog of war. All coordinates are logical pixels on the fixed `1280 x 720`
stage defined in `specs/overview.md` (origin top-left, `x` right, `y` down). The
field mirrors about the vertical centerline `x = 640`; every left-side coordinate
below has a mirror-image counterpart on the right.

## The three horizontal zones

The stage is divided top to bottom into three fixed zones:

1. **Top HUD strip** — `y = 0` to `y = 64`. The resource readout, income rate,
   wave timer, and the two base health bars live here (see `specs/flow.md`).
2. **The lane** — `y = 64` to `y = 468` (height `404`), full width `x = 0` to
   `x = 1280`. This is the battlefield: bases, Reliquaries, and all moving units
   live here. Its vertical center is `y = 266`.
3. **The staging yards** — `y = 480` to `y = 720` (height `240`). The player's
   yard is the left half (`x = 16` to `x = 624`); the enemy's yard is the right
   half (`x = 656` to `x = 1264`), separated by a central gutter. Structures are
   placed here, safely off the lane, and the enemy's half is under fog (below).

Draw the lane as sand (`#9c8452`) with faint horizontal banding (`#7a663d`) so
motion along it reads; draw the staging-yard zone as the dark panel color
(`#241a10`).

## Bases

Each side has one **base** — the objective. It is a fixed rectangle standing in
the lane against the side wall:

- **Player base:** `x = 8` to `x = 80`, `y = 176` to `y = 356` (72 wide, 180
  tall), drawn in the Ember team color.
- **Enemy base:** the mirror — `x = 1200` to `x = 1272`, same `y`, in Azure.

A base has **1200 HP**. When a hostile unit is within `40 px` of the base front
it attacks the base instead of moving further. A base with `0 HP` is destroyed
and the match ends (see `specs/flow.md`). A base does not fight back; it is
defended only by your units and your Reliquary's Aegis.

## Reliquaries

Partway between each base and midfield stands a **Reliquary** — a fortified
neutral-looking monument, drawn in the Reliquary color (`#ecd58c`) with the
owner's team accent:

- **Player Reliquary:** centered at `(372, 266)`, `72` wide by `96` tall.
- **Enemy Reliquary:** the mirror, centered at `(908, 266)`.

A Reliquary has **900 HP** and belongs to the side on whose half of the field it
stands. It blocks nothing — units path around it — but enemy units in range will
attack it. Destroying the **enemy** Reliquary is a major objective; its rewards
and the Aegis it summons are defined in `specs/waves.md`. A Reliquary that has
taken no damage regenerates slowly (`+8 HP/s`) up to its maximum, so a committed
push is needed to bring one down, not a stray shot.

## The build grid

Each staging yard holds a grid of square cells where **spawner structures** are
placed (economy in `specs/economy.md`):

- Cell size is **72 x 72 px**.
- The **player grid** is **8 columns x 3 rows** (24 cells). Its top-left cell's
  top-left corner is at `(24, 492)`; columns step by `72` in `x`
  (`24, 96, 168, …, 528`) and rows step by `72` in `y` (`492, 564, 636`).
- The **enemy grid** mirrors it on the right.

A cell holds at most one structure. Placement, cost, and upgrades are in
`specs/economy.md`. The base and Reliquary are **not** on this grid; they are
pre-placed and permanent.

## Where units enter and travel

- **Player units** spawn at the **player muster line**, `x = 96`, spread over the
  lane's vertical extent (`y = 96` to `y = 436`), and travel to the **right**
  (`+x`) toward the enemy base.
- **Enemy units** spawn at `x = 1184` and travel **left** (`−x`).
- A unit advances along the lane until it acquires a target (an enemy unit,
  Reliquary, or base within its range — see `specs/units.md`), then stops to
  fight. The **front line** — where the two armies meet — therefore drifts toward
  whichever side is losing, which is the tug-of-war. Units spread across the
  lane's height rather than stacking in a single file; keep them within
  `y = 88` to `y = 444` so none overlap the HUD or the yards.

## Fog of war (required)

The player must **not** be able to see what the enemy is building or doing except
where the player has units. Fog is strict:

- The **entire enemy staging yard** (the right half of the yard zone, `x ≥ 656`,
  `y ≥ 480`) is permanently hidden under the fog color (`#150f08`): the player
  never sees the enemy's structures, their grid, or their placements. Draw it as
  an opaque fogged panel, not merely dimmed.
- The **lane** is revealed only within **vision**. The player's base, the
  player's Reliquary, and every player unit each reveal a circular area around
  them: base and Reliquary a radius of `180 px`, a unit a radius of `140 px`.
  Everything in the lane outside all player vision is drawn under fog, and
  **enemy units, and the enemy Reliquary and base, are drawn only when they fall
  within player vision** — an enemy unit in the fog is invisible until a player
  unit (or the base/Reliquary) sees it. Terrain already seen may stay dimly
  lit ("explored"), but **enemy units are shown only while currently in vision**,
  never as stale ghosts.
- The AI is subject to the same rule conceptually (it does not get to read the
  player's exact yard), but its fog need not be rendered — only the player's view
  is drawn.

The fog is the heart of the game: you counter what you *see* crossing the sand,
having built blind. Make it unmistakable in the gameplay reference.
