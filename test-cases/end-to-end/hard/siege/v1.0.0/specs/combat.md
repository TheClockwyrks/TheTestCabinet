# Siege — Classes, weapons, and the Scourge roster

This file defines what you fight with and what you fight. It covers the three
player **classes** and their weapons, how hitscan/projectile/arcing attacks
resolve, grenades, and the **Scourge roster** with its tiers and armor. Behaviors
(who chases whom, pathfinding, your squad) are in `specs/ai.md`; the phase/tier
schedule is in `specs/phases.md`. All values are world units, `u/s`, seconds, and
degrees, in the real, frame-rate-independent simulation time from
`specs/overview.md`.

## The player

You are one Warden on foot in the first person.

- **Health `100`.** No passive regeneration — the **only** healing is from a squad
  medic (`specs/ai.md`). At `0` HP you die and respawn per `specs/phases.md`.
- **Movement.** Walk `9 u/s`, sprint `14 u/s`, crouch `4.5 u/s`. Jump to about
  `1.3` units of height; you can step up terrain `1` unit high without jumping.
  Gravity applies; you cannot fly or leave the arena box (`specs/world.md`).
- **Loadout.** A **primary**, a **secondary**, and a **grenade**, set by class
  below. Switch between primary and secondary; each has its own magazine and
  reserve ammo. Reloading a weapon refills its magazine from its reserve. Reserve
  ammo does not regenerate on its own — a squad **engineer** is the only way to
  replenish it (`specs/ai.md`).
- **Aiming** is pointer-lock mouselook (`specs/flow.md`); the primary fire is the
  left button, aim-down-sights the right, reload `R`, grenade `G`, weapon swap
  `Q` or the number/scroll (`specs/flow.md`).

### Weapon behavior

Three attack mechanics appear in the game; a weapon uses one:

- **Hitscan.** The shot lands instantly along the aim ray at the moment of firing.
  It hits the first thing the ray meets within the weapon's **effective range** —
  a Scourge unit (damage per the weapon), a squad member or the player (no
  friendly damage — see below), a redoubt, or terrain (stops the ray). Any
  spread or recoil is presentation only; the ray is the hit test.
- **Projectile.** A discrete projectile travels from the muzzle at a finite speed,
  affected by gravity if the weapon is arcing. It deals its damage where it
  strikes (splash weapons deal area damage — below). Projectiles collide with
  terrain, structures, and units.
- **Arcing.** A projectile launched on a ballistic arc under gravity (grenades,
  the Breacher launcher, and Scourge artillery). It lands where the arc meets the
  world and detonates.

**No friendly fire.** Warden weapons and grenades damage only the Scourge (and do
not damage your own redoubts). Scourge weapons damage only Wardens and the active
redoubt. Splash follows the same rule — it never harms allies.

**Splash damage.** A splash weapon deals full damage at the point of impact and
falls off to zero at its blast radius; every enemy within the radius takes damage
scaled by distance. Radii are given per weapon.

### The three classes

Each class is a distinct answer to the assault. You pick one on the in-game spawn
UI each time you deploy or respawn (`specs/flow.md`); all three must be implemented
and playable.

| Class | Primary | Secondary | Grenade |
| --- | --- | --- | --- |
| **Ranger** | **Rifle** — hitscan, automatic. `14` dmg/shot, `0.1 s` cadence, magazine `30`, reserve `180`, effective range `90`, moderate spread. The all-rounder. | **Sidearm** — hitscan, `22` dmg, `0.28 s`, magazine `12`, reserve `96`, range `55`. | **Frag** ×`3`. Arcing; on impact, splash `110` dmg, blast radius `5`. |
| **Marksman** | **Long rifle** — hitscan, bolt-action, **anti-armor**. `70` dmg/shot (ignores armor — below), `0.9 s` cadence, magazine `6`, reserve `48`, effective range `220`, aim-down-sights zoom. Deletes single tough targets at range. | **Carbine** — hitscan, `11` dmg, `0.08 s`, magazine `25`, reserve `150`, range `70`. For when they close. | **Frag** ×`2`. As above. |
| **Breacher** | **Launcher** — arcing projectile, **splash**. `95` splash dmg, blast radius `4`, `1.0 s` cadence, magazine `4`, reserve `24`, muzzle speed `55 u/s`. Erases clustered infantry and breaks armor at close-to-mid range; weak at long range and slow to reload. | **Sidearm** — as Ranger's. | **Incendiary** ×`2`. Arcing; on impact creates a burning patch, radius `4`, dealing `25` dmg/s for `5 s` to Scourge inside it — area denial on an approach. |

## The Scourge roster

The Scourge field a **small set of archetypes**. Two things scale the assault, and
they are different levers (`specs/phases.md`):

- **Which archetypes are in play is set by the phase.** New phases **introduce new
  archetypes** — the roster grows as the siege deepens (Artillery arrives in phase
  B, Ravagers in phase C).
- **How tough a spawned unit is, is set by its tier.** The tier a unit spawns at is
  driven by the run's **kill count** on the schedule in `specs/phases.md` — not by
  elapsed time, and not by the redoubt's health — so clearing the field is answered
  by tougher replacements. A tier is the **same model re-plated** in a tier accent
  (`specs/overview.md`) — Tier I plain Ember, Tier II steel plating, Tier III bright
  elite trim — with more health, armor, and damage. You do **not** invent new
  geometry per tier; you re-skin and re-stat the one model.

Each unit is drawn as blocky Scourge geometry reading as the silhouette below, in
Ember with its tier accent, with a dark outline so it reads against the terrain.

### Archetypes (Tier I base stats)

| Archetype | Introduced | Role & target | HP | Armor | Attack | Speed |
| --- | --- | --- | --- | --- | --- | --- |
| **Rusher** | Phase A | Light melee; charges the **player and squad**. Cheap, fast, swarms. | `60` | none | Melee `18` dmg, `0.8 s` cadence, reach `2.5` | `9 u/s` |
| **Gunner** | Phase A | Ranged infantry; shoots the **player and squad** from range. | `50` | light | Hitscan `10` dmg, `0.6 s` cadence, range `70` | `6 u/s` |
| **Breaker** | Phase A | Sapper; **ignores the player and squad** and attacks the **active redoubt** only (`specs/phases.md`). Heavily armored, slow. | `320` | heavy | Melee `55` dmg to the redoubt, `1.5 s` cadence, reach `4` | `4 u/s` |
| **Artillery** | Phase B | Bombardment. Holds back near the spawn line and lobs arcing shells at the **player** (nuisance) and the **active redoubt**. | `140` | light | Arcing shell — telegraphed (below) | `3 u/s` (repositions slowly) |
| **Ravager** | Phase C | Heavy elite bruiser; wades into the **player and squad**, soaking fire to reach melee. Slow, very durable, hits hard — a target that demands anti-armor. | `500` | heavy | Melee `40` dmg, `1.2 s` cadence, reach `3` | `5 u/s` |

### Tiers — the kill-count quality ramp

Every archetype comes in three tiers, and the tier a unit spawns at rises with the
run's **kill count** (`specs/phases.md`), so the assault gets harder in quality, not
just count. Apply these multipliers to each archetype's Tier I base stats above:

| Tier | Appears | HP | Damage | Armor |
| --- | --- | --- | --- | --- |
| **I** | at a low kill count | ×`1.0` | ×`1.0` | as listed |
| **II** | at a mid kill count | ×`1.8` | ×`1.4` | +25% damage reduction |
| **III** | at a high kill count | ×`2.8` | ×`1.9` | +40% damage reduction |

- **Armor** reduces incoming damage by the listed percentage — **except** from
  **anti-armor** sources, which **ignore armor entirely**: the Marksman's long
  rifle and the Breacher's launcher. This is what makes those classes matter as the
  tiers climb inside a phase; the Ranger's sustained fire still works but pays the
  armor tax on Tier II/III. (Grenades are **not** anti-armor — they pay the armor
  tax.)
- Breakers (and Ravagers) are the toughest things on the field for their tier; a
  Tier III breaker should genuinely require focus (or anti-armor fire) to bring
  down before it saps the redoubt out from under you.

### Artillery and its telegraph

Artillery is the signature nuisance and a driver of redoubt damage from phase B on:

- An artillery unit selects an impact point — near the **player's current
  position** (offset a little so a standing player is forced to move) or on the
  **active redoubt** — and lobs an arcing shell at it.
- Before the shell lands, a **ground telegraph** appears at the impact point: a
  marked ring on the terrain, blast **radius `6`**, drawn in the telegraph warning
  color and pulsing to the imminent color as impact nears. The telegraph leads the
  impact by about **2.5 s**, long enough to clear the ring.
- On impact the shell detonates: **`75` splash damage** to a Warden caught in the
  ring (enough that ignoring it is near-fatal), and **`120`** to the redoubt on a
  redoubt-targeted shell. Splash falls off to the ring edge.
- Artillery fires roughly every **9 s** across the live artillery units in phase
  B, tightening and adding a second concurrent tube feel in phase C. It should read
  as a persistent pressure to reposition, not a constant carpet.

## Death and kills

A Scourge unit at `0` HP is destroyed (play a brief blocky break-apart or fade)
and increments the **kill counter** (`specs/phases.md`), whether you or a squad
member landed the killing blow. A destroyed unit deals no more damage. Downed
units do **not** drop pickups — the only healing is the squad medic and the only
reserve-ammo resupply is the squad engineer (`specs/ai.md`).
