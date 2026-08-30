# Spectra — The swarm

This file defines how any drone behaves, whatever kind it is: the four phases it
moves through, the entrance that brings it in, the formation it rests in, the dive
it launches, the fire that dive carries, and what a standard wave is made of. What
each of the three kinds does differently is in `specs/drones.md`.

The speeds below are the stage-1 figures. `specs/stages.md` states the scales a
later stage multiplies them by.

## The four phases

A drone is always in exactly one of four phases.

| Phase | The drone is |
| --- | --- |
| `entering` | Flying in from above the play field toward its formation slot |
| `formation` | Resting in its slot, riding the sway |
| `diving` | On an attack run down the field |
| `returning` | Looping back to its slot after a dive |

## The wave and its entrance

A wave is built as the stage-intro hold gives way, which `specs/stages.md` states.
The drone roster holds every drone of the wave from that moment, each in phase
`entering`, at its own starting point above `FIELD_TOP`, so no drone stands inside
the play field when the wave opens.

The wave releases them in groups. It carries a clock that starts at zero when the
wave opens and advances with game time while the wave's entry runs. A drone's group
is released when that clock reaches `ENTER_GROUP_GAP` (`0.6`) seconds times the
group's index, counted from `0`, so the first group is released as the wave opens
and each later group `ENTER_GROUP_GAP` after the one before it. A drone that has not
been released holds its starting point. A wave releases its drones in between two
and eight groups; how many drones a group holds, and which slot each takes, are
yours.

A released drone travels a smooth path of your design down to its slot, at
`ENTER_SPEED` (`260`) units per second along that path. The path is continuous and
may cross the upper field and curve back. It carries the drone across `FIELD_TOP`
into the play field within one second of its release, it ends with the drone at its
slot within six seconds of its release, and the drone is then in phase `formation`,
riding the sway with the rest of the block.

## The formation

A drone in phase `formation` sits at its slot plus the sway offset
`specs/field.md` fixes, and it stays there until it is launched into a dive or
destroyed.

Which slots a wave fills is yours, subject to three rules.

- The filled layout is mirror-symmetric about `FORM_CENTER_X`: for every filled slot
  at `x`, the slot at `2 * FORM_CENTER_X - x` is filled too.
- The formation holds at least one drone of each effective band at all times while
  it is assembled.
- It reads as a deliberate block rather than a scatter, and the filled shape may
  differ from stage to stage.

## The dive

The wave carries one dive clock, in seconds. It advances with game time while the
wave's dive launching runs, and it returns to `0` each time a dive is launched.

| Launch | Happens when the dive clock reaches |
| --- | --- |
| The wave's first dive | `DIVE_FIRST_DELAY` (`2.0`) seconds |
| Each later dive | A value drawn between `DIVE_GAP_MIN` (`1.4`) and `DIVE_GAP_MAX` (`2.6`) seconds, multiplied by `diveGapScale(stage)` |

A launch takes one drone resting in the formation, chosen at random from those
standing, and puts it in phase `diving`. Which one it takes is drawn from the
game's own generator.

A diving drone follows a smooth swooping path of your design down through the field,
at `DIVE_SPEED` (`300`) units per second along that path. The path:

- bends toward the ship's current `x`, so it closes on the ship rather than running
  a fixed track, while staying wide enough to dodge;
- is continuous, with one exception: a dive that leaves below `FIELD_BOTTOM`
  re-appears above `FIELD_TOP` and carries on, and that wrap is the only
  discontinuity a dive ever holds;
- ends either by turning back above `FIELD_BOTTOM` without ever entering the bottom
  HUD strip, or by wrapping through the bottom as above.

A dive runs no longer than eight seconds. Once the path is done the drone enters
phase `returning` and travels back to its slot, reaching it within four seconds,
where it enters phase `formation` again and may be launched into a later dive.

## Enemy fire

Only a drone in phase `diving` fires. A drone entering, resting in formation, or
returning fires nothing.

A diver takes its first shot in the frame its center first crosses `DIVE_FIRE_Y`
(`360`) traveling downward. How many shots it takes over the dive is the kind's,
and `specs/drones.md` states it for each.

An enemy bullet travels straight down at `ENEMY_BULLET_SPEED` (`320`) units per
second, multiplied by `bulletSpeedScale(stage)`. It is drawn `ENEMY_BULLET_W` (`6`)
by `ENEMY_BULLET_H` (`12`), with a contact half-extent of `ENEMY_BULLET_HALF` (`8`).

An enemy bullet carries the band its firer stores at the shot, fixed for the
bullet's life. A spectral inversion swaps a drone and its bullets alike, so a bullet
always reads as the band its firer reads as.

## What a standard wave is made of

A standard wave's formation holds:

- Shards of both bands as the bulk of it;
- at least two Fluxes; and
- at least one Prism.

The total grows with the stage, up to the grid's capacity, and later stages lean
further on Fluxes and Prisms. `specs/stages.md` states the one stage that is not a
standard wave.
