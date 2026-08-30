# Spectra — Stages

This file defines the sequence of stages a run moves through, the challenge stage
that interrupts it, and how a later stage scales. The screens a stage passes through
are in `specs/ui.md`.

## The sequence

Stages are numbered from `1` and run without an end. A standard stage is one wave,
built as `specs/swarm.md` states.

- The wave for a stage is built in the moment the stage-intro hold gives way to the
  live wave. The field is empty for that hold: no drone stands on it and no bullet
  of either side is in flight, so a stage always opens on a clear field.
- A standard stage clears in the moment the last drone of its wave is destroyed. A
  live wave that holds no drone and has had none removed is being played rather than
  cleared, so a stage that was never given a drone never clears.
- A cleared stage opens the stage-cleared interstitial. When that gives way, the
  stage number is one higher and the next stage's intro opens, and every drone and
  every bullet left over from the finished stage has left the field.

## Challenge stages

`isChallengeStage(stage)` is `stage % CHALLENGE_EVERY === 0`, with `CHALLENGE_EVERY`
(`3`), so every third stage is a challenge stage rather than a standard wave.

A challenge stage is a non-firing flyover.

- It holds `CHALLENGE_GROUPS` (`5`) groups of `CHALLENGE_PER_GROUP` (`8`) drones,
  `CHALLENGE_TOTAL` (`40`) in all, released on the same schedule a wave's entry
  groups run on.
- Every drone in a group carries the same band, and consecutive groups carry
  opposite bands, so the bands alternate from the first group to the last.
- A challenge drone holds one band for its whole flyover. A flyover carries no drone
  that oscillates between the bands and none that wears two layers at once, so the
  band a group reads as never changes while it crosses.
- No drone fires. No enemy bullet appears anywhere in a challenge stage.
- A challenge drone's body costs no life. Contact between the ship and one of them
  does nothing.
- Each group sweeps across the play field along a path of your design and leaves it
  within eight seconds of the group's release. A challenge drone never settles into a
  formation slot, and one that leaves the field is removed.
- A challenge drone holds phase `entering` for the whole flyover. It never reaches
  `formation`, and nothing puts it into `diving` or `returning`, so a discharge wave
  reaches it as `specs/resonance.md` states.
- The stage ends in the moment the last of its drones has left the field or been
  destroyed. It then opens the stage-cleared interstitial, which reports the result
  `specs/ui.md` states.

The ship still moves, fires, flips, and discharges during a challenge stage.

## Scaling

A standard stage at `stage` scales four figures. Each formula takes the stage number
and returns a multiplier or a duration.

| Figure | Formula | Bound |
| --- | --- | --- |
| `droneSpeedScale(stage)` | `min(1.50, 1 + 0.06 * (stage - 1))` | Capped at `1.50` |
| `bulletSpeedScale(stage)` | `min(1.40, 1 + 0.04 * (stage - 1))` | Capped at `1.40` |
| `diveGapScale(stage)` | `max(0.55, 1 - 0.05 * (stage - 1))` | Floored at `0.55` |
| `fluxHold(stage)` | `max(1.0, FLUX_HOLD_L1 - 0.05 * (stage - 1))` seconds, with `FLUX_HOLD_L1` (`1.6`) | Floored at `1.0` |

`droneSpeedScale` multiplies the entrance and dive speeds in `specs/swarm.md`,
`bulletSpeedScale` the enemy bullet speed there, `diveGapScale` the gap between dive
launches there, and `fluxHold` is the held part of a Flux's band window in
`specs/drones.md`.

The formation also grows with the stage, up to the grid's capacity, leaning further
on Fluxes and Prisms.

A challenge stage does not scale. Whatever stage it falls on, it runs at the stage-1
figures.

Nothing else changes with the stage. The band rules, the shield, the meter, the
discharge, the scoring, and the lives are the same at every stage.
