# Sunfront — The battlefield

This file defines the geometry of the field: the **diagonal arena** where units
fight, the two **corner bases**, the two Reliquaries, the staging yards where
structures are placed, and the fog of war. Gameplay runs on a **logical horizontal
ground plane** rendered in 3D (`specs/overview.md`).

## The ground plane

The arena is a square **`1200 × 1200`** logical-unit ground plane. A position on it is
`(x, z)`; `x` runs along one edge, `z` along the other, and **`+y` is up** (used only
for rendering — model height, the camera, flight altitude). The origin `(0, 0)` is the
**player's corner**; the enemy's corner is the opposite one at `(1200, 1200)`.

- **The main diagonal** is the line from `(0, 0)` to `(1200, 1200)` — the axis units
  advance along. The battle is a single **corridor** centred on this diagonal, about
  `480` units wide (perpendicular half-width `240` either side of the diagonal); units
  spread across the corridor's width rather than stacking in single file.
- **The diagonal midline** is the perpendicular anti-diagonal through the arena centre
  `(600, 600)` — the set of points where `x + z = 1200`. It divides the field into the
  **player's half** (`x + z < 1200`) and the **enemy's half** (`x + z > 1200`). This is
  the "midfield" the Aegis never crosses (`specs/waves.md`).
- **The layout has 180° rotational symmetry about `(600, 600)`.** Every position on
  the player's side maps to its enemy-side counterpart by rotating `180°` about the
  centre: `(x, z) → (1200 − x, 1200 − z)`. Every coordinate below is given for the
  player; the enemy's is that mirror.

Render the arena floor as sand (`#9c8452`) with faint banding **along the diagonal**
(`#7a663d`) so motion toward the enemy corner reads; the staging yards are the dark
panel color (`#241a10`).

## The HUD

The HUD is a **2D overlay** drawn over the 3D view (not on the ground plane): a top
strip for the sol/income readout, the wave clock, and the two base health bars, plus
the build palette and selected-structure panel around the player's staging yard. Its
layout and contents are in `specs/flow.md`. Keep every HUD element inside the fitted
16:9 view at all window sizes (`specs/overview.md`).

## Bases

Each side has one **base** — the objective — standing in its corner, rendered from its
provided model (`specs/assets.md`, the `bastion`), facing along the diagonal toward the
enemy corner:

- **Player base:** centred at `(130, 130)`, in the player's corner, drawn tinted Ember.
- **Enemy base:** the mirror, centred at `(1070, 1070)`, tinted Azure.

A base has **1200 HP**. When a hostile unit is within `40` units of the base it attacks
the base instead of advancing further. A base at `0 HP` is destroyed and the match ends
(`specs/flow.md`). A base does not fight back; it is defended only by your units and
your Reliquary's Aegis.

## Reliquaries

Partway along the diagonal between each base and the arena centre stands a **Reliquary**
— a fortified neutral-looking monument, rendered from its provided model
(`specs/assets.md`, the `reliquary`) in the Reliquary color (`#ecd58c`) with the owner's
team accent:

- **Player Reliquary:** centred on the diagonal at `(360, 360)`.
- **Enemy Reliquary:** the mirror, centred at `(840, 840)`.

A Reliquary has **2000 HP** and belongs to the side on whose half it stands. It
blocks nothing — units path around it — but enemy units in range attack it.
Destroying the **enemy** Reliquary is a major objective; its rewards and the Aegis
it summons are in `specs/waves.md`. A Reliquary that has taken no damage
regenerates at **`4 HP/s`** up to its maximum, so bringing one down needs a
committed push, not a stray shot.

## The staging yards and build grid

Each staging yard sits **behind its own base**, in the corner, off the diagonal
corridor — the player's around the origin corner, the enemy's around `(1200, 1200)`
(under fog). Structures are placed here, safely off the lane, and rendered from their
provided structure models (`specs/assets.md`).

- Each yard holds a grid of square cells, cell size **`72 × 72`** units.
- The **player grid** is **8 × 3** (24 cells) laid in the player's corner behind the
  base, its cells stepping by `72` in `x` and `z`; the enemy grid mirrors it about the
  centre. (The exact corner offset is yours, as long as the grid sits behind the base,
  clear of the diagonal corridor, and reads as the player's yard.)
- A cell holds at most one structure. The base and Reliquary are **not** on this grid;
  they are pre-placed and permanent — never built or sold, but still **selectable for
  info** (`specs/flow.md`). Spawners and Solar Extractors are build-grid structures.
  Placement, cost, and upgrades are in `specs/economy.md`.

## Where units enter and travel

- **Player units** spawn at the **player muster line** — a segment just ahead of the
  player base along the diagonal, centred near `(230, 230)` and spread across the
  corridor width (perpendicular to the diagonal) — and travel toward the **enemy
  corner** (increasing `x + z`).
- **Enemy units** spawn at the mirror muster line near `(970, 970)` and travel toward
  the player corner (decreasing `x + z`).
- A unit advances along the diagonal until it acquires a target (an enemy unit,
  Reliquary, or base within its range — `specs/units.md`), then stops to fight. The
  **front line** — where the two armies meet — therefore drifts along the diagonal
  toward whichever side is losing, which is the tug-of-war. Units spread across the
  corridor's width rather than stacking, and stay within the corridor so none wander
  off the arena or into the yards.

## Fog of war (required)

The player must **not** be able to see what the enemy is building or doing except where
the player has units. Fog is strict:

- The **entire enemy staging yard** (the enemy corner's yard) is permanently hidden
  under the fog color (`#150f08`): the player never sees the enemy's structures, their
  grid, or their placements. Draw it as an opaque fogged region, not merely dimmed.
- The **arena** is revealed only within **vision**. The player's base, the player's
  Reliquary, and every player unit each reveal a circular area around them: base and
  Reliquary a radius of `180` units, a unit a radius of `140`. Everything in the arena
  outside all player vision is under fog, and **enemy units, and the enemy Reliquary
  and base, are drawn only when they fall within player vision** — an enemy unit in the
  fog is invisible until a player unit (or the base/Reliquary) sees it. Terrain already
  seen may stay dimly lit ("explored"), but **enemy units are shown only while
  currently in vision**, never as stale ghosts.
- Because the camera shows only part of the arena and **pans** across it
  (`specs/flow.md`), scrolling to a stretch of the field where the player has no unit or
  structure nearby shows **only fog** there — no units or structures are drawn outside
  the player's vision, wherever the camera is pointed.
- The AI is subject to the same rule conceptually (it does not get to read the player's
  exact yard), but its fog need not be rendered — only the player's view is drawn.

The fog is the heart of the game: you counter what you *see* crossing the sand, having
built blind. Make it unmistakable in the gameplay reference.
