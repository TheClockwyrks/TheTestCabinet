# Orrery — The simulation

This file defines what happens when a machine runs: the run's lifecycle, the
cycle every tape loops on, how arms move and carry, the collision rule with
worked examples, every fault, the order sigils act in, and the three metrics a
completed run records. The parts are defined in `specs/parts.md`, the sigils
in `specs/sigils.md`, the instructions in `specs/instructions.md`, and the hex
geometry in `specs/field.md`.

## The run

A run simulates the machine as placed in the editor. It begins from the `play`
or `step` action of `specs/editor.md`, which states when those actions start
one. The editor's parts are locked for the whole run.

Starting a run:

1. Every arm and wheel takes its rest pose, holding nothing, and every wheel's
   six fixtures appear on its spoke hexes.
2. The settle runs: one pass of the boundary sequence defined below, on a
   field holding only fixtures.
3. The cycle counter starts at `0` and the machine begins cycle `0`.

Stopping a run, from the `back` action in any sim status, discards the motes
and every runtime pose and returns to editing with the machine exactly as it
was placed.

## Cycles and the clock

`sim.cycle` counts completed cycles. The cycle now running is cycle
`sim.cycle`, and each arm and wheel executes its tape cell at index
`sim.cycle` modulo the period `P` of `specs/instructions.md`.

A cycle is one unit of simulated machine time. Its progress is `sim.fraction`,
from `0` to `1`. While the sim is running, an update advances the fraction by
`SPEEDS[sim.speed] * dt` cycles, where `dt` is the frame's delta time in
seconds and `SPEEDS` is `[1, 3, 10, 30]` cycles per second, indexed by the
speed setting `0` to `3`; `DEFAULT_SPEED_INDEX` is `1`. The speed actions of
`specs/controls.md` move the setting one step and stop at `0` and at `3`. A
frame may complete several cycles; each runs in full, in order.

`sim.status` is one of `running`, `paused`, `faulted`, and `complete`. The
fraction advances only while the status is `running`, so pausing holds it
where it is. A cycle completes when the accumulated fraction reaches `1`, and
the excess carries into the next cycle. A span of game time that lands
exactly on a boundary completes that cycle however many frames covered it,
so one second at speed step `0` completes exactly one cycle whether it
arrived as one frame or as sixty. A `collision` leaves the fraction at
that sample's `k / 8`; every other fault and completion leaves it at `0`. A
completing or faulting boundary leaves `sim.cycle` at the cycle just run.
Which action produces `running` rather than `paused` is in `specs/editor.md`.

One cycle runs in this order:

1. Fetch. Each part reads its tape cell for this cycle. A blank cell is a rest
   on every part, a wheel included, and never faults. A non-blank cell the
   part cannot perform raises the fault named for it under Faults. The wheel
   rule takes precedence: a wheel given anything but `rotate-cw` or
   `rotate-ccw` faults as `impossible` whatever else would apply. When more
   than one part faults at one fetch, the run raises the fault of the earliest
   such part in placement order and names that part.
2. Drops. Every gripper of every part whose instruction is `drop` opens.
3. Grabs. Every gripper of every part whose instruction is `grab` closes; a
   gripper over a mote that is not a fixture takes hold of that mote's
   constellation. A gripper over a fixture or over nothing closes on nothing.
4. Motion. The moving parts sweep across the cycle, as the next section
   defines, with the torn check at its start and the collision check at each
   sample.
5. Boundary. Motes are at rest on hex centers again. The boundary sequence
   runs: the sigil phase, then sets, then rises, then the area bank, then the
   completion check. When the run does not complete, `sim.cycle` increments
   and the next cycle begins.

## Motion and carrying

An instruction imposes a rigid motion over the cycle, parameterized by the
fraction `t` from `0` to `1`:

| Instruction               | Motion of the part                                                                                              | Motion imposed on each held constellation                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `rotate-cw`, `rotate-ccw` | The part's direction turns 60 degrees about its base, clockwise or counterclockwise, sweeping `60 * t` degrees. | The same rotation about the base.                                    |
| `pivot-cw`, `pivot-ccw`   | The part does not move.                                                                                         | Rotation about the holding gripper's hex, sweeping `60 * t` degrees. |
| `extend`, `retract`       | The piston's length changes by one, its gripper translating one hex along its spoke.                            | Translation by the same vector, linearly in `t`.                     |
| `advance`, `recede`       | The base translates to the adjacent track cell, wrapping on a closed track.                                     | Translation by the same vector, linearly in `t`.                     |
| `grab`, `drop`, blank     | None.                                                                                                           | None.                                                                |

A carried constellation moves as one rigid body: every mote of it follows the
motion, and at `t = 1` every mote lands exactly on a hex center. A mote held
by nothing rests on its hex for the whole cycle. Fixtures are carried by their
wheel's rotation and rest otherwise.

Grips persist across cycles until dropped and ride the motion of the part that
holds them.

A mote may be carried over, dropped on, and rest on a hex off the field. Off
the field it collides, is grabbed, and is banked exactly as on it, and no
sigil acts on it.

### Held more than once

A constellation may be held by several grippers at once, and the drop and grab
steps may create that freely. At the start of the motion step, every held
constellation's imposed motions must agree: each holding gripper imposes the
motion of its own part's instruction, and unless every imposed motion is the
same one, the run faults as `torn`. Motions agree when they are all no motion,
all the same translation vector, or all rotation about the same center in the
same direction.

## Collision

`COLLISION_SAMPLES` is `8`. Within the motion step, every mote's position is
evaluated at the sample fractions `t = k / 8` for `k` from `1` to `8`, in
order. If at any sample the distance between the centers of two motes is
strictly less than `2 * MOTE_COLLIDE_R` (`38`), the run faults as `collision`
at that sample, naming every pair within the threshold at that sample. Every
pair is checked, fixtures included.

The following worked examples pin the rule. Coordinates are the axial hexes of
`specs/field.md`, distances are in logical units rounded to two decimals, and
the threshold is `38`.

| #   | Configuration                                                                                                                                                                                    | First sample within `38` | Nearest sampled approach | Outcome |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ------------------------ | ------- |
| A   | An arm at `(0, 0)`, length 1, carries a mote from `(1, 0)` toward `(0, 1)` with `rotate-cw`. A mote rests on `(1, 1)`.                                                                           | `36.10` at `t = 3/8`     | `35.14` at `t = 4/8`     | Faults  |
| B   | The same sweep, with the resting mote on `(1, -1)`.                                                                                                                                              | none                     | `53.33` at `t = 1/8`     | Clear   |
| C   | An arm at `(0, 0)`, length 2, carries a mote from `(2, 0)` toward `(0, 2)` with `rotate-cw`. A mote rests on `(1, 0)`.                                                                           | none                     | `48.81` at `t = 1/8`     | Clear   |
| D   | The same sweep, with the resting mote on `(1, 1)`.                                                                                                                                               | `37.16` at `t = 1/8`     | `12.86` at `t = 4/8`     | Faults  |
| E   | A piston extends, carrying a mote from `(1, 0)` to `(2, 0)`. A mote rests on `(2, -1)`.                                                                                                          | none                     | `41.57` at `t = 4/8`     | Clear   |
| E2  | The same slide, with the resting mote on `(1, 1)`.                                                                                                                                               | none                     | `41.57` at `t = 4/8`     | Clear   |
| F   | The same slide, with the resting mote on `(3, -1)`.                                                                                                                                              | none                     | `48.00` at `t = 8/8`     | Clear   |
| G   | Two arms swap two motes between `(1, 0)` and `(0, 1)`, one rotating clockwise about `(0, 0)` and the other clockwise about `(1, 1)`.                                                             | `37.16` at `t = 1/8`     | `12.86` at `t = 4/8`     | Faults  |
| H   | Two motes rest on `(0, 0)` and `(1, 0)`. Nothing moves.                                                                                                                                          | none                     | `48.00` at every sample  | Clear   |
| I   | A track arm advances east, carrying a mote from `(0, 0)` to `(1, 0)`. A mote rests on `(1, -1)`.                                                                                                 | none                     | `41.57` at `t = 4/8`     | Clear   |
| J   | Two arms on one track both advance east, carrying motes on `(0, 0)` and `(1, 0)`.                                                                                                                | none                     | `48.00` at every sample  | Clear   |
| K   | An open track through `(-1, 0)`, `(0, 0)`, `(1, 0)`, `(2, 0)`, `(3, 0)`. An arm at `(-1, 0)` carries a mote on `(0, 0)` and advances; an arm at `(3, 0)` carries a mote on `(2, 0)` and recedes. | `36.00` at `t = 5/8`     | `0.00` at `t = 8/8`      | Faults  |

A faulting run freezes at the first sample within `38`, which may precede the
nearest approach.

A move ending on a hex another mote rests on faults: the sample at `t = 8/8`
finds the two motes at distance `0`.

## Faults

`FAULTS` names every way a run halts:

| Fault           | Raised                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `collision`     | Two motes within `38` at a sample.                                                                                             |
| `torn`          | A held constellation's imposed motions disagree.                                                                               |
| `overextended`  | `extend` on a piston already at `ARM_MAX_LEN` (`3`).                                                                           |
| `overretracted` | `retract` on a piston already at `ARM_MIN_LEN` (`1`).                                                                          |
| `unmounted`     | `advance` or `recede` on a part not on a track.                                                                                |
| `track-end`     | `advance` at the last cell, or `recede` at the first cell, of an open track.                                                   |
| `impossible`    | `extend` or `retract` on a part that is not a piston, or any non-blank instruction but `rotate-cw` or `rotate-ccw` on a wheel. |

A fault freezes the run where it stood: the status becomes `faulted` and
nothing advances further. `back` returns to editing.

A fault names what raised it:

| Fault             | `parts`                              | `motes`                                             |
| ----------------- | ------------------------------------ | --------------------------------------------------- |
| `collision`       | empty                                | every mote of every pair within `38` at that sample |
| `torn`            | every part holding the constellation | every mote of the constellation                     |
| Every fetch fault | the faulting part                    | empty                                               |

Both lists name each part and each mote once, however many pairs or grips
reached it. `parts` is in placement order and `motes` is in ascending mote id.

## The sigil phase

At each boundary, the settle included, sigils act in four waves, each wave
completing before the next:

1. The transmuting sigils: `wane`, `mirror`, `ascend`, `conjoin`, `eclipse`,
   `confluence`, `dispersion`.
2. The binding sigils: `bind`, `manifold`, `triune`.
3. `sunder`.
4. `void`.

Within a wave, sigils act one at a time in reading order of their anchor hex:
ascending `r`, then ascending `q`. Each sigil reads the field as the sigils
before it left it. Each sigil's condition and effect are in `specs/sigils.md`.

After the four waves, every set is evaluated, then every rise, each in the
same reading order. A set consumes every constellation it accepts before any
rise spawns.

## Completion and metrics

After the rises, if every set's tally has reached the challenge's `target`,
the run completes: the status becomes `complete` and the metrics are recorded.
A run whose machine holds no set never completes.

| Metric   | Value                                                                             |
| -------- | --------------------------------------------------------------------------------- |
| `cost`   | The machine's cost, as `specs/parts.md` computes it.                              |
| `cycles` | `sim.cycle + 1` at the completing boundary: the number of cycles the machine ran. |
| `area`   | The size of the area bank below.                                                  |

The area bank is a set of hexes accumulated across the run. At the start of
the run it takes every hex of every placed part, every fixture hex, and every
gripper hex at rest. A placed part's hexes are an arm or wheel's anchor, every
cell of a track, and every footprint hex of a sigil, rise, or set. After every
boundary, the settle included, it takes the hex of every mote and of every
gripper, before that boundary's completion check reads it. A hex off the field
is banked like any other. `area` is how many distinct hexes the bank holds
when the run completes.

Completing a challenge marks it solved, unlocks what its mode unlocks, and
updates the challenge's records, as `specs/modes/campaign.md` and
`specs/modes/extras.md` describe.

## Determinism

The simulation is a function of the machine and the elapsed simulated time.
Cycle outcomes, collisions included, are computed from the machine's parts,
tapes, and the sample fractions, and no rule of the simulation draws on
randomness. The effects `specs/assets.md` fixes vary from one play to the
next, and that variation reaches nothing the simulation or the debug surface
reads. The full contract, and the operations that drive a run from code, are
in `specs/instrumentation.md`.
