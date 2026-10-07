# Fathom — The Gloamfin

The Gloamfin is eyeless and hunts by sound, sweeping the maze with sonar of its own.
This file defines its sense, its ping, its speeds, its search, and the states it
moves between. What every predator shares is in `specs/predators.md`. Every
figure below carries the name this specification gives it.

The Gloamfin reports `hearingRange` as `GLOAMFIN_HEAR` (`64`) and `detectRange`,
`flareCharging`, `flaring` and `flareRadius` as `null`.

## Sense: three ways to be heard

The Gloamfin takes a fix by three paths, and each one is a fresh acquisition that
fires the detection alert `specs/predators.md` defines.

| The path                                                                                        | The fix it takes                                  |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Its own ping. The front of a ping it cast reaches the forager's tile.                           | The tile the front caught the forager on.         |
| The forager's pulse. The front of the forager's sonar pulse reaches the Gloamfin's tile.        | The forager's tile at that moment.                |
| Close hearing. The distance between the two centers is at most `GLOAMFIN_HEAR` (`64`), 2 tiles. | The forager's current tile, refreshed every step. |

Close hearing works in the dark, through rock, and through ink. While it holds, the
snapshot reports `hearingLock` true and the fix follows the forager step by step; it
reports false at every other moment. Ink changes nothing about any of the three
paths.

A fix taken by a ping or by the forager's pulse names the tile the forager was on when
the front arrived and stays on that tile afterward, so the Gloamfin drives to where the
sound was rather than to where the forager has since gone.

## Its ping: the tell

A Gloamfin out of the den carries a ping timer. The timer runs down every step,
whatever the Gloamfin is doing, and when it reaches `0` the Gloamfin casts a ping,
provided at least `GLOAMFIN_PING_MIN_GAP` (`3 s`) has passed since its last ping and
`hearingLock` is false. Casting a ping sets the timer back to `GLOAMFIN_PING_INTERVAL`
(`4 s`) and starts that minimum gap again. A Gloamfin that holds a close-range hearing
lock is silent for as long as it holds it, and pings as soon as the lock breaks.

A ping is the same traveling sonar wavefront as the forager's pulse, cast from the
Gloamfin's tile and flooding outward through the open corridors to a path range of
`GLOAMFIN_PING_RANGE` (`9`) corridor steps. It travels at the wavefront speed
`specs/sensing.md` fixes and appears in the snapshot's `pulses` with `source`
`"gloamfin"`. An ordinary ping is drawn in the Gloamfin's own violet and reports `tint`
`"violet"`.

A ping reveals no tile, remembers no tile, and marks no predator and no drifter. It
does not draw the Gloamfin that cast it, which stays hidden until the forager's light,
a sonar mark, or its own detection alert shows it. It carries the sound outward, so it
catches the forager when its front reaches the forager's tile rather than the instant
it is cast, and it catches the forager at most once.

## Speeds

| While it is | It travels at, in logical units per second                 |
| ----------- | ---------------------------------------------------------- |
| Wandering   | `PREDATOR_SPEED` (`116`), steady for as long as it wanders |
| Chasing     | its chase speed, at most `GLOAMFIN_CHASE_SPEED` (`134`)    |
| Searching   | `PREDATOR_SPEED` (`116`)                                   |

The wander speed never winds up: a Gloamfin that has wandered for a minute travels at
`PREDATOR_SPEED` exactly as one released a moment ago.

The chase speed is a value the Gloamfin carries while it chases. A fresh acquisition
opens the chase at `GLOAMFIN_CHASE_SPEED`, above the forager's own speed. Every corner
it turns costs it that edge:

- On any step where the chase turns onto a perpendicular direction, the chase speed
  drops to `GLOAMFIN_CORNER_SPEED` (`115`), below the forager's speed. A straight run
  and a reversal are not turns and leave it alone.
- From there the chase speed climbs steadily back to `GLOAMFIN_CHASE_SPEED`, reaching
  it `GLOAMFIN_RAMP_TIME` (`2 s`) after the turn, and holds at that cap.

## Search: reaching an empty tile

A chasing Gloamfin that arrives on its fixed tile and finds the forager gone starts to
search. It reports `state` as `"search"`, slows to `PREDATOR_SPEED`, and casts about
that tile, staying within `GLOAMFIN_SEARCH_ROAM` (`2`) tiles of it and turning back
toward it whenever it drifts further. The search lasts `GLOAMFIN_GIVEUP` (`5 s`) from
the arrival, after which the Gloamfin drops the fix and returns to `"wander"`.

`GLOAMFIN_SEARCH_DELAY` (`1.2 s`) into the search the Gloamfin casts one guaranteed
ping, whatever its ping timer says. That ping is drawn orange and reports `tint`
`"orange"`, plainly apart from the violet of an ordinary one. It obeys the same
`GLOAMFIN_PING_MIN_GAP` floor and the same silence under a hearing lock as any other
ping, waiting until both allow it, and it resets the ping timer to
`GLOAMFIN_PING_INTERVAL` exactly as an ordinary ping does. A search casts one such ping
at most.

A ping that catches the forager, the guaranteed one or any later one, is a fresh
acquisition: the Gloamfin takes the new fix, fires the alert, and chases again from its
opening cap.

## States

| From       | To         | When                                                       |
| ---------- | ---------- | ---------------------------------------------------------- |
| `"den"`    | `"wander"` | It has swum out of the den chamber after its release time. |
| `"wander"` | `"chase"`  | Any of the three senses takes a fix.                       |
| `"chase"`  | `"search"` | It reaches its fixed tile and the forager is not there.    |
| `"search"` | `"chase"`  | Any of the three senses takes a fix.                       |
| `"search"` | `"wander"` | `GLOAMFIN_GIVEUP` runs out.                                |
