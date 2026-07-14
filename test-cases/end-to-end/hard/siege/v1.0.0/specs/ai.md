# Siege — Pathfinding, the Scourge AI, and your squad

This file defines how units move and decide: 3D **pathfinding** over the terrain,
the **Scourge** behaviors, and your friendly **squad** (a rifleman, a machine
gunner, a medic, and an engineer), including the medic healing and engineer
resupply rules and the respawn timers. It builds on the roster and
stats in `specs/combat.md`, the world in `specs/world.md`, and the phase schedule
in `specs/phases.md`. Values are world units, `u/s`, and seconds of real,
frame-rate-independent simulation time (`specs/overview.md`).

## Pathfinding in 3D

Every non-player character navigates the voxel terrain in three dimensions —
this is a core requirement, not a nicety. The terrain is **non-destructible**
(`specs/world.md`), so it can be treated as static for path planning, but the
world is **dynamic** in the units moving through it.

- Units path over the terrain surface: up and down slopes, around hills and rock,
  along the worn routes toward their target, **without** walking through solid
  terrain or off the arena edges. They step up terrain up to `1` unit and take
  short drops; they do not path up sheer faces the terrain generator was required
  to avoid (`specs/world.md`).
- A unit that cannot reach its target by the terrain does not freeze or jitter in
  place — it makes progress toward the reachable-most point. Units must not clump
  into a vibrating pile or phase through one another; apply simple **local
  avoidance** so a crowd flows around obstacles and the redoubt rather than
  stacking on a single cell.
- Because attackers stream in continuously, pathing must stay cheap enough to run
  many units at the required frame rate (`specs/overview.md`); how you keep it cheap
  is your choice.

## The Scourge

The Scourge exist to overrun the active redoubt. Each archetype
(`specs/combat.md`) has a fixed intent:

- **Rushers** path toward the **nearest Warden** (the player or a squad member),
  close to melee reach, and attack. If no Warden is near, they advance toward the
  active redoubt and attack whatever Wardens intercept them.
- **Gunners** path to within their firing range of the **nearest Warden**, then
  hold and fire, repositioning if the target breaks line of sight or leaves range.
- **Breakers** **ignore all Wardens** — they never target, chase, or shoot the
  player or squad. They path by the most direct reachable route to the **active
  redoubt** and attack it at melee reach until it falls or they are destroyed. They
  do not defend themselves; they only sap. This single-mindedness is deliberate:
  breakers are the clock on the redoubt, and the player's job is to kill them
  before they arrive, not to be distracted into a duel with them.
- **Artillery** (introduced phase B) holds back near the spawn line, repositioning
  slowly, and lobs telegraphed shells (`specs/combat.md`) at the player or the
  redoubt. It does not push forward into the melee.
- **Ravagers** (introduced phase C) path toward the **nearest Warden** like
  Rushers, but are far tougher and wade through fire to reach melee. They are a
  Warden threat, not a sapper — they do not target the redoubt; you cannot ignore
  them the way you must not ignore a breaker.

Scourge units spawn at the phase's spawn line on the schedule in `specs/phases.md`.
A wave is a small **mixed** group — the archetypes the current phase has in play
(`specs/phases.md`), mostly Rushers and Gunners with Breakers arriving on their own
cadence — spawned at whatever tier the run's kill count has reached
(`specs/phases.md`). The AI does not cheat: attackers have the stats in
`specs/combat.md` and no more, and they must be **killable** — a competent player
thins each wave, but the new archetypes, tightening breaker cadence, and climbing
tiers still carry the redoubt down (`specs/phases.md`).

The Scourge should read as a coordinated tide, not a single-file line: they spread
across the width as they advance, flow around terrain and the redoubt toward their
targets, and press from more than one angle where the terrain allows.

## Your squad

You fight alongside a **four-Warden squad** — a **Rifleman**, a **Machine Gunner**,
a **Medic**, and an **Engineer** — AI allies who fight, follow the defense, die,
and respawn. They are the analogue of the enemy AI and must be genuinely useful
without winning the siege for the player. Two of them are **support** roles that do
not exist to out-shoot the Scourge: the medic is the only source of **healing**,
and the engineer the only source of **reserve-ammo resupply**.

| Squad member | Count | HP | Weapon | Behavior |
| --- | --- | --- | --- | --- |
| **Rifleman** | 1 | `90` | Hitscan `12` dmg, `0.4 s` cadence, range `75` | Balanced damage dealer. Holds near the active redoubt, acquires and fires on the nearest attacker in range, repositions to keep firing lanes, and falls back with the defense. |
| **Machine Gunner** | 1 | `100` | Hitscan `8` dmg, `0.15 s` cadence, range `70` | Suppressive volume of fire — a high rate at lower per-shot damage. Heavier and slower to reposition than the rifleman; anchors a firing lane near the redoubt and holds sustained fire on the densest group of attackers. |
| **Medic** | 1 | `80` | Hitscan `20` dmg, `1.2 s` cadence, **range `120`** (long) | Support / the **only** healer. Its long weapon keeps it **hanging back** — it positions behind the line, plinks at range, and prioritizes **healing** (below). |
| **Engineer** | 1 | `85` | Hitscan `14` dmg, `0.5 s` cadence, range `70` | Support / the **only** ammo resupply. Hangs back like the medic, fires when safe, and prioritizes **resupplying reserve ammo** to nearby Wardens (below). Marked in the ammo/accent color (`specs/overview.md`). |

### Medic healing — the only way to heal

Healing exists **only** through the medic. There are no health pickups, no
regeneration, and no other heal source anywhere in the game.

- The medic, every **1.0 s**, heals the **most-wounded friendly within `40`** units
  (the player or a squad member below full health) for **`18` HP**, never above
  that unit's maximum. With a single medic there is no stacking — keeping the medic
  alive and nearby matters.
- The medic **never heals a redoubt** — redoubts do not regenerate (`specs/world.md`).
- The medic positions to keep wounded allies (especially the player) in healing
  range while staying back from the melee; it pulls back rather than pushing into a
  rush. Healing should be visible — a brief heal beam or the teal heal-accent
  (`specs/overview.md`) between medic and target — so the player can read who is
  being healed.

### Engineer resupply — the only way to refill reserve ammo

Reserve ammo is replenished **only** through the engineer — the ammo analogue of
the medic. There are no ammo pickups and reserve does not regenerate on its own.

- The engineer, every **2.5 s**, resupplies the **most ammo-depleted friendly
  within `40`** units (the player or a squad member) by topping up its **reserve**
  ammo — a chunk toward that weapon's maximum reserve, never above it. It does not
  refill the magazine directly (the Warden still reloads) and does not resupply
  grenades.
- The engineer positions and pulls back like the medic, staying in resupply range
  of the line rather than pushing into the melee. Resupply should be visible — a
  brief beam or the ammo/accent color (`specs/overview.md`) between engineer and
  target — so the player can read who is being resupplied.

### Squad targeting and movement

- Squad members acquire the **nearest attacker they can hit** and hold that target
  until it dies or leaves range, rather than switching every frame.
- Squad members ignore Breakers' non-aggression — they will still shoot a Breaker
  like any other attacker (a Breaker just never shoots back).
- The squad follows the defense: when a redoubt falls and the front falls back
  (`specs/phases.md`), living squad members relocate to the new active redoubt.

### Squad respawn

- A squad member killed respawns after **20 s** — **longer** than the player's
  `5 s` (`specs/phases.md`) — at the squad respawn point behind the active redoubt
  (`specs/world.md`), at full health.
- Respawns are unlimited; the squad is never permanently lost. Starting a siege at
  phase B or C begins with a **full** four-member squad (`specs/phases.md`).
- The HUD **squad panel** (`specs/flow.md`) always shows each of the four members:
  alive with a health bar, or dead with a respawn countdown. This is a required
  HUD element so the player can read the squad's state at a glance.
