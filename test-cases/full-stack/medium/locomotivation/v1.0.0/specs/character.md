# Locomotivation — the worker

The **worker** is the character the player controls: a yard hand who runs, hauls
freight, and dies under trains. How it **moves and animates** in the ¾ view is half
of what this build is judged on. All numbers below are the **initial, tunable**
values the balance pass may adjust; implement them as named constants so they are
easy to tune.

## Footprint and facing

- The worker occupies about **one tile**. Its **collision footprint** is a small box
  roughly `24 x 20` logical px centered on its feet (the base of the sprite); use
  the footprint — not the full sprite height — for wall/gap blocking and for lethal
  train overlap.
- The worker has **four facings** — **down, up, left, right** — set by its current
  (or last) movement direction. Facing drives which directional sprite/animation
  draws (`specs/assets.md`). This is a real front/back/left/right character, **not**
  one sprite mirrored.

## Movement

- Movement is **continuous** and **cardinal**: hold a direction (WASD or arrow keys,
  `specs/controls.md`) and the worker moves at its current speed in that direction.
  Releasing stops it (there is **no** momentum/sliding — movement is crisp for
  precise crossings). If two perpendicular keys are held you may either pick one
  axis or move diagonally at the same speed; do not let diagonal exceed the cardinal
  speed.
- **Base speed** (unladen, or lightly loaded): `V0 = 160` px/s (4 tiles/second).
- The worker is blocked by **Wall** and **Gap** tiles and by the level bounds; it
  slides along a blocked edge rather than sticking.

### Carry-weight speed model

The worker can carry freight up to a **maximum carry weight** `W_max = 120` units
(`specs/cargo.md` gives package weights). Let `w = load / W_max` be the current
fraction of capacity in use. The worker's **base speed multiplier** `m(w)` is:

| Load fraction `w` | Speed multiplier `m(w)` | Sprint |
| --- | --- | --- |
| `0 ≤ w ≤ 0.50` | `1.00` (full speed) | available |
| `0.50 < w ≤ 0.80` | linear from `1.00` down to `0.70` | available |
| `0.80 < w ≤ 1.00` | linear from `0.70` down to `0.50` | **disabled** |

So the current walk speed is `V0 * m(w)`. Concretely: an empty worker and a single
light **Parcel** move at full speed; a **Crate** slows you a little; a heavy **Load**
puts you in the gradual-slow band; and combining packages past 80% capacity both
crawls you and **locks out sprint entirely**. Picking up one more package can tip you
across the 0.80 line, so *what* you choose to carry is a constant decision
(`specs/cargo.md`).

### Sprint

- Holding the **sprint** key (Shift, `specs/controls.md`) makes the worker sprint:
  speed becomes `V0 * m(w) * SPRINT_MULT`, `SPRINT_MULT = 1.6`. Because sprint
  multiplies the **already weight-reduced** speed, a loaded sprint covers less
  ground than an empty one — the load fights you even when you sprint.
- Sprint is a **fixed-duration** burst governed by a **recharging bar**:
  - `SPRINT_MAX = 1.6` seconds of sprint at full charge.
  - The bar **drains** while sprinting and **recharges** while not, refilling from
    empty to full in `SPRINT_RECHARGE = 4.0` seconds.
  - Sprint is unavailable while the bar is empty (it must recharge), and **disabled
    entirely** while the load fraction `w > 0.80` (over the threshold there is no
    sprint regardless of charge; the HUD shows sprint **LOCKED**).
- Because the yard is a **criss-cross** — the same corridors re-crossed many times —
  sprint is a **route** resource: burn it to make a closing gap and you arrive at the
  next crossing with a half-empty bar. Manage it across a trip, not one crossing.

## Carrying, multi-carry, and dropping

The full cargo rules are in `specs/cargo.md`; the worker-side behavior:

- **Pick up** (`specs/controls.md`): standing on or adjacent to a package (or a
  dispenser's output), press the pick-up key to lift it into the carried set,
  **provided** the added weight keeps `load ≤ W_max`. If it would exceed capacity,
  the pick-up is refused (a small denial cue).
- **Multi-carry**: the worker may hold **several** packages at once (up to the
  weight cap), of any colors. Carried packages ride visibly with the worker
  (stacked/carried in the ¾ sprite; heavier total reads as more laboured).
- **Deliver**: entering a drop zone **auto-delivers** every carried package whose
  color matches that zone (`specs/cargo.md`); non-matching packages stay carried.
- **Drop** (`specs/controls.md`): press the drop key to set down the
  **most-recently picked-up** carried package at the worker's tile (or the nearest
  free adjacent tile if its own is occupied). Dropping is the emergency valve —
  ditch weight to regain speed and dive clear. **Where** it lands decides its fate
  (`specs/cargo.md`): off a track it is safe and retrievable; **on a track the next
  train destroys it**.

## Death and respawn

- The worker dies the instant its footprint overlaps **any** train car — engine,
  boxcar, or the sides of any car (`specs/trains.md`). There is no partial hit and
  no invulnerability window while crossing.
- On death: play the **squish** (a sharp flatten, `specs/assets.md`) and its
  particle burst and impact sound; **all packages the worker was carrying are
  destroyed** in the same collision (no phasing — if the train hit the worker it hit
  the freight too), firing the cargo-splinter VFX; a **life** is spent
  (`specs/flow.md`); and after a brief beat the worker **respawns at the level's
  spawn point**, empty-handed. Deliveries already banked persist.
- Because death destroys carried cargo, **dying while carrying a unique package
  fails the level** regardless of lives remaining (`specs/cargo.md`,
  `specs/flow.md`) — the unique haul is the one moment lives do not save you.

## Animation states

The worker is drawn from **produced sprite-sheet cycles** (`specs/assets.md`),
authored for **each of the four facings** unless noted. It must visibly animate a
distinct cycle for each state:

| State | When | Notes |
| --- | --- | --- |
| **Idle** | standing still | A subtle breathing/settle bob per facing. |
| **Walk** | moving, not sprinting, unladen or lightly laden | A clear four-facing walk cycle. |
| **Sprint** | moving while sprinting | Faster, leaning cadence. |
| **Carry** | moving or idle while carrying freight | Visibly laden — arms/back loaded; a heavier total load reads as more laboured (a slower, hunched cadence). Combine with walk/sprint per facing. |
| **Drop** | on dropping a package | A brief set-down beat. |
| **Squish** | on death under a train | A sharp flatten/impact — the signature death (not a facing-specific walk). |

A stiff, single-frame, or purely code-drawn worker — or one that only mirrors a
left/right pair instead of having real front and back facings — is a **failed
build**, not an acceptable placeholder. See `specs/assets.md` for the exact sheets,
frame counts, and wiring.
