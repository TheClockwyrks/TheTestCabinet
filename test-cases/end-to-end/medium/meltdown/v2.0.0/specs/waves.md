# Meltdown — The run

A run is a sequence of `N` waves fought on the one floor, where `N` comes from
the mode and difficulty in `specs/modes.md`. This file defines the phases a run
moves through, what each wave carries and how it is released, and how a run is
won and lost.

## The simulation advances itself

The game advances by the elapsed time of every frame, multiplied by the game
speed. Every rate in this specification is per second and is integrated against
that game time, and `simTime` accumulates it, so an interval of game time reaches
the same state however it was divided into frames.

## The three phases

The `playing` screen runs in one of three sub-phases.

| Phase | What it is | Surge released |
| --- | --- | --- |
| `opening` | The untimed phase before Wave 1 | None |
| `building` | The countdown between waves | None |
| `wave` | A wave is being released and fought | Yes |

Placing, upgrading, and selling are allowed in all three.

### The opening phase

The opening phase runs before Wave 1. It carries no countdown, reports a
`buildTimer` of `0`, and never starts a wave on its own however long it runs.
Sending is what begins Wave 1.

### A build phase

A build phase between waves begins with `buildTimer` at `BUILD_PHASE_TIME`
(`15`) seconds. The timer falls by one second per second of game time. Reaching
`0` starts the wave, and sending starts it earlier.

## Wave numbering

A run opens on Wave 1; there is no Wave 0. The current wave number is the wave
being prepared for or fought, so a build phase belongs to the wave that follows
it and the number reads the same right through that phase.

The number rises by one when a wave clears, never when one is released. Clearing
Wave `N` ends the run rather than advancing, so the number never passes `N`.

## What a wave carries

Each wave fields a single type, given by the wave number `w` and the run's wave
count `n`. `specs/modes.md` names the one mode whose single wave is mixed, and
the figures it replaces:

```
milestoneWaves(n) = [round(n / 2), n]

waveType(w, n) =
  "core"                if w = n or w = round(n / 2)
  WAVE_OPENING[w - 1]   if w <= 8
  WAVE_CYCLE[(w - 9) mod 5]   otherwise

WAVE_OPENING = [mote, mote, sprint, swarm, mote, drift, mote, hulk]
WAVE_CYCLE   = [mote, sprint, swarm, drift, hulk]
```

`round` rounds a half upward, so `round(n / 2)` is `10` in a 20-wave run, `8` in
a 15-wave run, and `13` in a 26-wave run.

The two milestone waves, `round(n / 2)` and `n`, are Core waves whatever the
opening list or the cycle would otherwise give. In a 20-wave run those are Wave
10 and Wave 20, and Waves 11 through 19 read Swarm, Drift, Hulk, Mote, Sprint,
Swarm, Drift, Hulk, Mote. In a 15-wave run they are Wave 8 and Wave 15.

How many units a wave releases:

```
waveSize(w, n) =
  1                                                    if waveType(w, n) = "core"
  ceil(WAVE_BASE_COUNT[waveType(w, n)] * (1 + WAVE_GROWTH * (w - 1)))   otherwise
```

`WAVE_GROWTH` is `0.22`, and `WAVE_BASE_COUNT` is `12` for the Mote, `10` for the
Sprint, `24` for the Swarm, `8` for the Drift, `5` for the Hulk, and `1` for the
Core. So Wave 1 releases 12 Motes and a milestone wave releases exactly one Core.

## The release

A wave releases its units one at a time, one every `WAVE_SPAWN_INTERVAL` (`0.6`)
seconds of game time, the first on the frame the wave begins. There is no
variation in that cadence.

Each unit's vent is drawn from the game's seeded generator, the two vents equally
likely. That draw is the only randomness in the game, so a run replayed from the
same seed releases the same sequence of vents.

## Per-wave scaling

A unit released on wave `w` carries `hpScale(w)` times its base hp:

```
hpScale(w) = 1 + 0.62 * (w - 1)
```

Nothing else scales with the wave. Speeds, bounties, and leak values are the same
on the last wave as on the first, and every other system is unchanged across a
run. `specs/modes.md` names the one mode that scales hp by a fixed figure
instead.

## Clearing a wave

A wave clears on the frame in which its last live unit dies or leaks with none of
it left to release. A phase that has released no unit never clears.

On that frame the wave-clear bonus and its score are paid, as `specs/economy.md`
states. Then:

- If the wave cleared was Wave `N`, the run ends in victory, and the victory
  screen opens.
- Otherwise the wave number rises by one and a build phase for the next wave
  begins, with its timer at `BUILD_PHASE_TIME` and its interest paid.

## Victory and loss

Victory is reached by clearing Wave `N` with at least one life left.

Lives reaching `0` ends the run at once, on the frame it happens and whatever the
phase, and opens the game-over screen. A leak that takes the lives to `0` on the
final wave therefore ends the run in loss, not in victory. Lives never
regenerate.

## Pause and speed

While the game is paused the simulation does not advance: nothing moves, no heat
changes, no clock counts down, no unit is released, and `simTime` holds where it
was. Resuming continues from exactly there.

The game-speed toggle sets `speed` to `1` or `2`, and the game time a frame
advances by is that frame's elapsed time multiplied by `speed`, so at `2` the
game advances twice the game time per unit of elapsed time and `simTime` gains
twice as fast. The speed changes how fast a run plays and not what it reaches:
the same game time delivered at either setting leaves the floor in the same
state.
