# Deepcore — The prospector

This file defines the character the player controls: how it moves, how it drills,
how fuel and hull behave, and the animation states it moves through. Every figure
below carries the name this specification gives it.

The prospector is a suited miner carrying a handheld drill and wearing a
back-mounted jetpack. It occupies an axis-aligned box `MINER_W` (`56`) by
`MINER_H` (`72`) units, so it passes through a shaft one tile wide. Its position
is continuous in world units and is not snapped to the grid; collision is against
the tile grid.

## Movement

| Quantity | Name | Value |
| --- | --- | --- |
| Gravity | `GRAVITY` | `1500` units per second squared |
| Walk and lateral drift speed | `WALK_SPEED` | `250` units per second |
| Fall terminal speed, empty | `FALL_TERMINAL_EMPTY` | `950` units per second |
| Fall terminal speed, at the lift limit | `FALL_TERMINAL_LOADED` | `1600` units per second |

- Falling. With open space below, the miner accelerates downward at `GRAVITY` up
  to its terminal speed. Falling costs no fuel.
- Terminal speed rises with the load. It is
  `FALL_TERMINAL_EMPTY + (FALL_TERMINAL_LOADED - FALL_TERMINAL_EMPTY) * min(1, load)`,
  where `load` is the load fraction below.
- Lateral movement. Holding left or right moves the miner horizontally at
  `WALK_SPEED`, on the ground and in the air alike.
- Collision. The miner's box never overlaps a cell that is not a tunnel. It rests
  on top of solid cells and is stopped by walls.
- No ceiling. The sky above the camp is unbounded. The miner may thrust straight
  up out of the mine and keep climbing while it has fuel, and it falls back when
  thrust is released. Fuel is spent and hull damage taken above the surface
  exactly as below it.

## Weight and lift

Every unit of ore carries a weight. The load fraction is
`load = loadKg / liftLimitKg`, where `loadKg` is the total weight in the cargo bay
and `liftLimitKg` is the heaviest load the current jetpack tier can climb with.

Holding thrust fires the jetpack. While it is held:

- The net vertical acceleration is `climbAccel` upward, where
  `climbAccel = emptyAccel * max(0, 1 - load)` and `emptyAccel` is the jetpack
  tier's empty-load climb acceleration. Gravity contributes nothing further while
  thrust is held.
- Upward speed is capped at `climbCap`, where
  `climbCap = emptyClimb * (1 - (1 - CLIMB_CAP_FLOOR) * min(1, load))`,
  `CLIMB_CAP_FLOOR` is `0.58`, and `emptyClimb` is the jetpack tier's empty-load
  climb speed.

At `load` of `1` or more the climb acceleration is `0`: holding thrust arrests the
fall's acceleration and produces no climb, so the miner cannot lift off. This is
the overload wall. The cargo bay is capped by slot count rather than by weight, so
a bay full of light shallow ore lifts easily while a bay part-filled with heavy
deep ore can already exceed the lift.

The escape from an overload is dropping ore. The inventory is openable anywhere
and discards one unit of a chosen ore at a time, so the player sheds weight until
the load fraction falls below `1`. Dropped ore is lost rather than sold. The
status bar reads `OVERLOAD` while `load` is `1` or more.

## Drilling

The miner drills the tile it is moving into: down, left, or right. It never drills
upward, so the only way to ascend is the jetpack through tunnels already carved.

- Grounded only. A cut starts only while the miner rests on a solid cell. A
  falling, thrusting, or hovering miner starts no cut whichever direction is held.
- Side cuts start at the tile edge. Holding left or right first walks the miner
  across the cell it stands in, and the cut into the neighbouring cell begins only
  once the miner's box is flush against it.
- A down cut sinks smoothly. While down is held and the cell below is minable, the
  miner's feet travel from the top of that cell to its bottom in proportion to the
  cut's progress, `1 - health / BAND_HEALTH`, so a held shaft reads as one
  continuous bore and the miner arrives flush on the next cell exactly as the cell
  it was cutting breaks. With open space or lava below the cell being cut, the
  miner does not sink; when that cell breaks it falls into the opening.
- Hits and health. The drill lands a hit every `DRILL_HIT_INTERVAL` (`0.125`)
  seconds, each hit spending `DRILL_HIT_FUEL` (`0.25`) fuel and removing the drill
  tier's damage from the target cell's health. The cell breaks when its health
  reaches `0`, so the hits to break it are `ceil(BAND_HEALTH / damagePerHit)`, the
  time is `hits * DRILL_HIT_INTERVAL`, and the fuel is `hits * DRILL_HIT_FUEL`.
- Damage persists. A cell partly cut keeps its remaining health when the miner
  moves away, and the fuel already spent is not refunded. Returning to it resumes
  from the health it holds.
- What a broken cell yields. Rock yields nothing. An ore cell banks one unit of
  its ore into cargo. A material node banks its material into the satchel. A gas
  pocket detonates instead of clearing cleanly. A lava cell clears and burns hull.
  Every one of them becomes an open tunnel.
- What never yields. A drill aimed into unbreakable stone or the bedrock border
  starts no cut and makes no progress. The Core is drilled downward to extract a
  Core Sample and is never removed.

## Fuel

Fuel is the jetpack's charge. It is spent by thrusting, by drifting laterally in
the air, by drilling, and by being underground, and it is replenished only by
paying for it at the Fuel Depot. The maximum is set by the fuel tank tier.

| Drain | Name | Value |
| --- | --- | --- |
| Thrust, at zero upward speed | `THRUST_BURN_MAX` | `5` fuel per second |
| Thrust, at or above the cruise speed | `THRUST_BURN_MIN` | `2` fuel per second |
| Upward speed at which the eased rate is reached | `CRUISE_SPEED` | `900` units per second |
| Lateral drift in the air | `AIR_BURN` | `2` fuel per second |
| Life support, while below the surface ground line | `LIFE_SUPPORT_BURN` | `0.4` fuel per second |
| Each drill hit | `DRILL_HIT_FUEL` | `0.25` fuel |

While thrust is held the burn is
`THRUST_BURN_MAX + (THRUST_BURN_MIN - THRUST_BURN_MAX) * min(1, up / CRUISE_SPEED)`,
where `up` is the miner's upward speed, then multiplied by the world size's
`THRUST_BURN_SIZE_MULT`:

| Size | `THRUST_BURN_SIZE_MULT` |
| --- | --- |
| `quick` | `2` |
| `standard` | `1` |
| `marathon` | `0.67` |

Only the thrust burn is scaled by the world size. `CRUISE_SPEED` sits above every
loaded climb cap and below every empty one, so an empty or light climb earns the
eased rate and a heavy haul pays the full rate the whole way up. Walking and
standing still cost no fuel.

Fuel never refills on its own, on the surface or anywhere else. Below
`LOW_FUEL_FRACTION` (`0.2`) of the maximum, the fuel gauge takes the alert
treatment and the low-fuel alarm cue plays.

Fuel reaching `0` while the miner is below the surface ground line strands it: the
jetpack is dead and there is no way up. That is a death.

## Hull

Hull is the miner's health, spent by hazards and repaired only by paying for it at
the Fuel Depot. The maximum is set by the hull tier.

- Damage comes from a gas detonation, lava contact, drilling through lava, a hard
  landing, and the Core Sample detonation.
- The radiator tier reduces lava damage only, both the contact drain and the lump
  for drilling through a lava cell. Nothing reduces gas damage.
- Below `LOW_HULL_FRACTION` (`0.25`) of the maximum, the hull gauge takes the
  alert treatment.
- Hull standing at `0` destroys the miner, whatever emptied it, and is checked
  continuously rather than only at the blow that emptied it. That is a death. An
  empty hull is never a state the expedition continues from.
- Hull never mends on its own.

## Animation states

The miner is in exactly one animation state at a time, and the state is readable
from the frame on screen. The miner also faces `east` or `west`, following the
last lateral input, and its sprite mirrors to match.

| State | The miner is |
| --- | --- |
| `idle` | Standing on solid ground, not moving and not drilling. |
| `walk` | Moving laterally along the ground. |
| `drill-down` | Braced and cutting the cell below. |
| `drill-side` | Braced and cutting the cell beside it. |
| `jetpack` | Holding thrust. |
| `fall` | Descending through open space without thrust. |
| `hurt` | Taking damage. The state holds for `HURT_TIME` (`0.4`) seconds from the blow, then gives way to whatever the miner is doing. |
| `fuel-out` | Below the surface with fuel at `0`. |

Each state is a produced animation cycle, played frame by frame on a timer while
the state holds.
