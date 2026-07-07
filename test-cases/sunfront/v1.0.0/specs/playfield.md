# Sunfront — The battlefield

This file defines the geometry of the field: the lane where units fight, the two
bases, the two Reliquaries, the staging yards where structures are placed, and
the fog of war. All positions are **world units** on the **ground plane** defined
in `specs/overview.md`: **`+X` is the advance axis** (the player holds low `X`,
the AI high `X`), **`Z` is the lateral (width) axis**, and **`+Y` is up** — every
structure and unit stands on the ground with real height. The field mirrors about
the centerline `x = 640`; every player-side position below has a mirror-image
counterpart on the AI's side. The HUD is a **screen-space overlay** over the
world, not part of the ground plane (see `specs/flow.md`).

## The two ground zones

The battlefield ground plane divides across `Z` into two zones:

1. **The lane** — `z = 64` to `z = 468` (width `404` across `Z`), full length
   `x = 0` to `x = 1280`. This is where units fight: bases, Reliquaries, and all
   moving units live here. Its lateral center is `z = 266`.
2. **The staging yards** — `z = 480` to `z = 720` (depth `240`), the two walled
   build aprons behind the fighting line. The player's yard is the low-`X` half
   (`x = 16` to `x = 624`); the AI's yard is the high-`X` half (`x = 656` to
   `x = 1264`), separated by a central gutter. Structures are placed here on the
   ground, safely off the lane, and the AI's half is under fog (below).

Render the lane ground as sand (`#9c8452`) with faint banding (`#7a663d`) so
motion along it reads; render the staging-yard ground as the dark panel color
(`#241a10`). Give the ground and its structures enough relief that the camera
reads it as a 3D field, not a flat map (`specs/overview.md`).

## Bases

Each side has one **base** — the objective. It is a fixed structure standing on
the lane against the side boundary, with real height:

- **Player base:** `x = 8` to `x = 80`, `z = 176` to `z = 356` (72 across `X`, 180
  across `Z`), modelled in the Ember team color.
- **Enemy base:** the mirror — `x = 1200` to `x = 1272`, same `z`, in Azure.

A base has **1200 HP**. When a hostile unit is within `40` units of the base front
it attacks the base instead of moving further. A base with `0 HP` is destroyed
and the match ends (see `specs/flow.md`). A base does not fight back; it is
defended only by your units and your Reliquary's Aegis.

## Reliquaries

Partway between each base and midfield stands a **Reliquary** — a fortified
neutral-looking monument, modelled in the Reliquary color (`#ecd58c`) with the
owner's team accent:

- **Player Reliquary:** centered at `(x = 372, z = 266)`, `72` across `X` by `96`
  across `Z`, standing tall.
- **Enemy Reliquary:** the mirror, centered at `(x = 908, z = 266)`.

A Reliquary has **900 HP** and belongs to the side on whose half of the field it
stands. It blocks nothing — units path around it — but enemy units in range will
attack it. Destroying the **enemy** Reliquary is a major objective; its rewards
and the Aegis it summons are defined in `specs/waves.md`. A Reliquary that has
taken no damage regenerates slowly (`+8 HP/s`) up to its maximum, so a committed
push is needed to bring one down, not a stray shot.

## The build grid

Each staging yard holds a grid of square cells on the ground where **spawner
structures** are placed (economy in `specs/economy.md`):

- Cell size is **72 x 72** units on the ground plane.
- The **player grid** is **8 columns (across `X`) x 3 rows (across `Z`)** (24
  cells). Its first cell's corner is at `(x = 24, z = 492)`; columns step by `72`
  in `X` (`24, 96, 168, …, 528`) and rows step by `72` in `Z` (`492, 564, 636`).
- The **enemy grid** mirrors it on the high-`X` side.

A cell holds at most one structure. Placement, cost, and upgrades are in
`specs/economy.md`. The base and Reliquary are **not** on this grid; they are
pre-placed and permanent.

## Where units enter and travel

- **Player units** spawn at the **player muster line**, `x = 96`, spread across
  the lane's width (`z = 96` to `z = 436`), and travel toward **high `X`** (`+X`)
  toward the enemy base.
- **Enemy units** spawn at `x = 1184` and travel toward **low `X`** (`−X`).
- A unit advances along the lane until it acquires a target (an enemy unit,
  Reliquary, or base within its range — see `specs/units.md`), then stops to
  fight. The **front line** — where the two armies meet — therefore drifts toward
  whichever side is losing, which is the tug-of-war. Units spread across the
  lane's width rather than stacking in a single file; keep them within
  `z = 88` to `z = 444` so none stray off the lane into the yards.

## Fog of war (required)

The player must **not** be able to see what the enemy is building or doing except
where the player has units. Fog is strict:

- The **entire enemy staging yard** (the high-`X` half of the yard zone,
  `x ≥ 656`, `z ≥ 480`) is permanently hidden under the fog color (`#150f08`): the
  player never sees the enemy's structures, their grid, or their placements. Draw
  it as an opaque fogged volume, not merely dimmed.
- The **lane** is revealed only within **vision**. The player's base, the
  player's Reliquary, and every player unit each reveal a circular area of ground
  around them: base and Reliquary a radius of `180` units, a unit a radius of
  `140` units. Everything in the lane outside all player vision is drawn under
  fog, and **enemy units, and the enemy Reliquary and base, are drawn only when
  they fall within player vision** — an enemy unit in the fog is invisible until a
  player unit (or the base/Reliquary) sees it. Ground already seen may stay dimly
  lit ("explored"), but **enemy units are shown only while currently in vision**,
  never as stale ghosts.
- The AI is subject to the same rule conceptually (it does not get to read the
  player's exact yard), but its fog need not be rendered — only the player's view
  is drawn.

The fog is the heart of the game: you counter what you *see* crossing the sand,
having built blind. Make it unmistakable in the 3D world.
