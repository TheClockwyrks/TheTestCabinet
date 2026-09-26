# Meltdown — Targeting and damage

An emitter fires on its own: there is no manual trigger. This file defines what
it can reach, what it picks, how often it fires, what a shot removes, and the two
emitters whose shot does something more. `specs/towers.md` gives each emitter's
figures and `specs/heat.md` the multiplier every shot is scaled by.

## Range

An emitter's range is a radius in tiles from its footprint's centre. A surge unit
is in range when the distance from that centre to the unit's centre is at most
`range * TILE` logical units, where `range` is the emitter's range at its current
level. A unit one logical unit further out is not in range.

Range is measured from the footprint's centre at every size, so a 4x4 Lance
reaches the same distance in every direction from the centre of its sixteen
tiles.

## The target

An emitter targets the in-range unit with the smallest `remaining`, which is the
unit furthest along its route to its exhaust. Two in-range units with the same
`remaining` are separated by taking the lower `id`. The target is chosen again on
every frame, so an emitter whose target dies, leaks, or leaves its range takes
the next unit under the same rule on the following frame.

Every emitter targets ground units and flyers alike, except the Flak, which
targets flying units alone and ignores every ground unit whatever its range. The
Forge and the Sink target nothing.

A unit immune to slowing is an ordinary target: it is chosen and fired on under
the rule above like any other unit.

## The fire clock

Each emitter carries a fire accumulator, in seconds:

- On a frame in which the emitter has a target and is online, the game time that
  frame advances by is added to the accumulator.
- On a frame in which it has no target, or is tripped, the accumulator neither
  grows nor falls.
- Each time the accumulator reaches `1 / fireRate` at the emitter's current
  level, one shot resolves and `1 / fireRate` is subtracted, so a frame long
  enough to cover several intervals resolves that many shots in order and the
  remainder carries into the next frame.

A run of firing therefore lands its first shot one full interval after the target
was acquired, not on the frame it appeared, and an emitter that has sat without a
target lands its first shot one full interval after the target arrives.

An emitter reports `firing` on a frame in which it has a target and is online, so
its accumulator is running. A tripped emitter reports `firing` false for the
whole of its cooldown.

## Damage

One shot removes

```
baseDamage(level) * heatMultiplier(H, redline)
```

from its target's hp, where `H` is the emitter's heat at the moment the shot
resolves. This is the damage every emitter's shot deals, with no exception: a
Rime's shot removes `4 * heatMultiplier(H, 100)` at level I exactly as an Arc's
shot removes `6 * heatMultiplier(H, 80)`.

A unit's hp never falls below `0`, and a unit at `0` hp is removed on that frame.

Each emitter tallies what it did, for its whole life on the floor:

- `damageDealt` accumulates the hp each of its shots actually removed, splash
  included, so a killing blow adds only the hp the unit had left.
- `kills` rises by one for each unit one of its shots takes to `0` hp.

The Forge and the Sink fire nothing, so both report `0` kills and `0` damage
dealt forever.

## The Bloom's splash

A Bloom's shot removes its damage from every unit whose centre lies within
`BLOOM_SPLASH` (`2.4`) tiles of the target's centre, which is `2.4 * TILE`
logical units. Each unit inside that radius takes the full per-shot damage once,
the target included, and a unit one logical unit outside it takes nothing.

## The Rime's slow

On the frame a Rime's shot resolves it applies a slow to its target, when the
target is slowable. The slow's strength falls as the Rime heats:

```
slowFactor(H) = slowCeil * (1 - H / 100)
```

`slowCeil` is the Rime's `RIME_SLOW_CEIL` at its current level, which
`specs/towers.md` gives. A Rime at heat `0` and level I therefore applies `0.55`,
a Rime at heat `50` applies `0.275`, and a Rime at heat `100` applies nothing at
all.

A slow removes that fraction of the unit's base speed, so a slowed unit's current
speed is `baseSpeed * (1 - slowFactor)`, and it lasts `SLOW_TIME` (`1.5`) seconds
from the moment it is applied.

A unit carries at most one live slow, held as a factor and the seconds it has
left. An incoming slow of factor `f` resolves against the live one in three flat
cases:

| The incoming slow          | The result                                                   |
| -------------------------- | ------------------------------------------------------------ |
| Stronger than the live one | The factor becomes `f` and the timer is set to `SLOW_TIME`.  |
| Equal to the live one      | The factor is unchanged and the timer is set to `SLOW_TIME`. |
| Weaker than the live one   | Neither the factor nor the timer changes.                    |

A unit carrying no slow takes an incoming one with its timer at `SLOW_TIME`. A
shot whose `slowFactor(H)` is `0` applies no slow at all.

The timer counts down against the game time each frame advances by. When it
reaches `0` the slow ends, the factor returns to `0`, and the unit is back at its
base speed.

A unit that is not slowable never carries a slow, whatever hits it and whatever
its factor would have been.
