# Sunfront — The unit roster and combat

This file defines every unit, the armor/attack **counter system** that makes
composition the game, and how combat resolves. Costs and upgrades are in
`specs/economy.md`; spawning, movement, and the front line are in
`specs/waves.md`; distances and speeds are logical units and units/s on the arena
ground plane defined in `specs/playfield.md`.

Both sides field the **same roster** (a mirror match). Each unit is rendered with
its **provided 3D model** (`specs/assets.md`) — you are given the models and must
load and use them, not draw your own — tinted to its owner's team color (Ember for
the player, Azure for the enemy) with the team energy accent, and shown at the
relative scale its authored dimensions imply. The model's locomotion clip plays while
it advances and its attack clip when it fires; when it is destroyed it flashes white a
few times and is removed.

## Armor classes and attack types — the counter system

Every unit has one **armor class** and its attack has one **attack type**. Damage
dealt is the attack's base damage times a **counter multiplier** read from this
matrix (times any upgrade bonus from `specs/economy.md`):

| Attack type ↓ / Armor → | Light | Heavy | Air |
| --- | --- | --- | --- |
| **Normal** | `1.0` | `0.75` | — |
| **Piercing** (anti-armor) | `1.0` | `1.5` | — |
| **Splash** (area, anti-swarm) | `1.5` | `0.75` | — |
| **Flak** (anti-air) | `0.5` | `0.5` | `2.0` |
| **Support** (no damage) | — | — | — |

A `—` means the attack **cannot target that armor class at all**. So:

- **Ground attacks** (`Normal`, `Piercing`, `Splash`) can only hit **ground**
  units (Light or Heavy) — they cannot touch **Air** units.
- **Air** units can therefore only be hit by **Flak**. A player with no Flak has
  no answer to air; a player with only Flak is nearly defenseless on the ground.
- **Splash** damage applies to **every** enemy within its area (below), so it
  shreds clustered Light swarms but is inefficient one-on-one against Heavy.
- **Piercing** is single-target and tears through Heavy armor.

This triangle is the game: read what crosses the sand and build its counter.

## The roster

Ten buildable units, plus the **Aegis** — not buildable, far larger and more
powerful than anything here, and the only unit with **independent per-turret
targeting**; it defends its own half and never crosses the diagonal midline (full
definition in `specs/waves.md`). Stats are base values at spawner level 1; upgrades
scale HP and damage per `specs/economy.md`.

| Unit | Cost | HP | Armor | Attack type | Dmg | Cadence | Range | Speed | Targets | Role |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Scarab** | 60 | 55 | Light | Normal | 8 | 0.6 s | 22 | 95 | Ground | Cheap fast melee swarm; screens the line, soaks fire. |
| **Trooper** | 80 | 70 | Light | Normal | 9 | 0.8 s | 90 | 70 | Ground | Cheap rifle infantry; short-ranged body that braces and holds ground. |
| **Sentinel** | 100 | 90 | Light | Normal | 12 | 0.9 s | 130 | 65 | Ground | Backbone ranged rifleman; longer reach, cost-efficient staple. |
| **Bulwark** | 200 | 420 | Heavy | Normal | 16 | 1.1 s | 26 | 45 | Ground | Heavy frontline; walks the line forward and eats fire. |
| **Lancer** | 180 | 80 | Light | Piercing | 26 | 1.4 s | 200 | 55 | Ground | Long-range marksman; deletes Heavy units, fragile. |
| **Bombard** | 280 | 130 | Light | Splash | 22 | 2.0 s | 240 | 40 | Ground | Siege artillery; erases swarms, helpless up close. |
| **Flakhound** | 150 | 120 | Light | Flak | 20 | 0.8 s | 190 | 60 | Air + Ground | Anti-air platform; near-useless against ground alone. |
| **Sunhawk** | 240 | 160 | **Air** | Normal | 14 | 0.7 s | 120 | 85 | Ground | Air gunship; flies over the line, only Flak stops it. |
| **Lumen** | 160 | 100 | Light | Support | — | — | 130 | 60 | Allies | Repair drone; heals nearby allies, deals no damage. |
| **Monolith** | 900 | 900 | Heavy | Splash | 40 | 1.5 s | 90 | 38 | Ground | Expensive capstone bruiser; slow, splashes the line. |

Notes on specific units:

- **Trooper** is the cheapest **ranged** body — a short-range rifle infantry that
  fills the line between the melee Scarab and the longer-reaching Sentinel. It is the
  one **skinned** model (its whole body deforms as one skin; `specs/assets.md`); when
  it stops to fire it plays its **`brace`** clip (a crouch-and-hold), a presentation
  behavior only — it confers no stat change.
- **Bombard** has a **minimum range of `70`**: an enemy closer than that is inside
  its arc and it cannot fire on it, so Bombards must be screened.
- **Flakhound** always targets an **Air** unit in range if one exists (its natural
  prey); only if none is in range does it fire on ground, at the `0.5` multiplier.
- **Sunhawk** is an **Air** unit: it ignores ground collision (it flies over
  friendly and enemy units alike) and travels straight down the lane. It attacks
  ground targets. Only **Flak** can damage it.
- **Lumen** deals no damage. Each `0.5 s` it heals the **most-wounded friendly
  unit within `130`** for **`14` HP** (never above that unit's max). It never
  heals bases or Reliquaries. Multiple Lumens stack.
- **Monolith** and **Bombard** deal **Splash**: on each hit, full damage lands on
  the target and the same damage (after the counter multiplier for each victim's
  armor) hits **all other enemies within the splash radius** — `60` for Monolith,
  `55` for Bombard — of the point of impact.

## Combat resolution

The simulation advances every frame in logical-pixel space:

- **Target acquisition.** A unit continuously seeks the **nearest enemy it can
  damage** (per the matrix) within its **range plus a `40 px` acquisition
  buffer**. Melee units (`range ≤ 30`) acquire almost adjacent; ranged units
  acquire at a distance. A unit with a target in range stops and attacks; a unit
  whose nearest valid target is within the acquisition buffer but not yet in range
  advances to close the gap; a unit with no valid target keeps advancing down the
  lane toward the enemy base. The **Aegis is the sole exception**: it holds to its
  own half of the field (never crossing the diagonal midline) and its three turrets each
  acquire a target independently — the main turret hunting Heavy in a forward cone,
  each side turret sweeping its own flank for Light — per `specs/waves.md`.
- **Attacking.** A unit fires once per its **cadence** while a valid target is in
  range, dealing `base damage × upgrade bonus × counter multiplier` (splash as
  above). Attacks are hitscan/instant for simulation purposes; a unit that fires a
  weapon **plays its provided muzzle-flash effect** at its muzzle while firing
  (`specs/assets.md`), while melee units (Scarab, Bulwark) and the support Lumen play
  none. Any projectile or impact touch beyond that is optional and drawn in code. A
  unit at `0 HP` is destroyed: it flashes white a few times to signal it is no longer
  functional and is then removed; it pays no bounty (`specs/economy.md`).
- **Attacking structures.** With no enemy units in range, a unit that reaches an
  enemy **Reliquary** or **base** within its range attacks it with the same damage
  rules (structures count as **Heavy** armor for the multiplier). Reaching and
  razing the enemy base wins the match.
- **No friendly fire.** Splash and all attacks damage only enemies (and structures
  of the enemy). Lumen healing affects only allies.
- **Determinism is not required**, but the model must be stable: units must not
  jitter between targets every frame (keep a target until it dies or leaves the
  acquisition range), and two opposing armies of equal composition and upgrades
  must grind to a **rough stalemate near the center of the diagonal front**, so
  that advantage comes from economy and counters, not from a lopsided default.
