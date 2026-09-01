# Orrery — The simulation

This file defines what happens when a machine runs: the run's lifecycle, the
cycle every tape loops on, how arms move and carry, the collision rule with
worked examples, every fault, the order sigils act in, and the three metrics a
finished solve records. The parts are defined in `specs/parts.md`, the sigils
in `specs/sigils.md`, the instructions in `specs/instructions.md`, and the hex
geometry in `specs/field.md`.

## The run

A run simulates the machine as placed in the editor. It begins from the `play`
or `step` action, as `specs/editor.md` describes, and only when every rise and
every set of the challenge is placed; otherwise the action does nothing and
the editor states why. The editor's parts are locked for the whole run.

Starting a run:

1. Every arm and wheel takes its rest pose, holding nothing, and every wheel's
   six fixtures appear on its spoke hexes.
2. The settle runs: one pass of the boundary sequence defined below, on a
   field holding only fixtures, which lets every unobstructed rise spawn its
   reagent.
3. The cycle counter starts at `0` and the machine begins cycle `0`.

Stopping a run, from the `back` action in any sim status, discards the motes
and every runtime pose and returns to editing with the machine exactly as it
was placed. Nothing a run does changes the editor.

## Cycles and the clock

`sim.cycle` counts completed cycles. The cycle now running is cycle
`sim.cycle`, and each arm and wheel executes its tape cell at index
`sim.cycle` modulo the period `P` of `specs/instructions.md`.

A cycle is one unit of simulated machine time. Its progress is `sim.fraction`,
from `0` to `1`. While the sim is running, an update advances the fraction by
`SPEEDS[sim.speed] * dt` cycles, where `dt` is the frame's delta time in
seconds and `SPEEDS` is `[1, 3, 10, 30]` cycles per second, indexed by the
speed setting `0` to `3`; `DEFAULT_SPEED_INDEX` is `1`. A frame may complete
several cycles; each runs in full, in order, exactly as it would have over
several frames.

One cycle runs in this order:

1. Fetch. Each part reads its instruction. An instruction its part cannot
   perform faults here, and the wheel check comes first: anything but a
   rotation on a wheel is `impossible`, mounted or not. On the other parts,
   `extend` past `ARM_MAX_LEN` (`3`) is `overextended`, `retract` past
   `ARM_MIN_LEN` (`1`) is `overretracted`, `advance` or `recede` on an
   unmounted part is `unmounted`, past the end of an open track is
   `track-end`, and `extend` or `retract` on anything but a piston is
   `impossible`.
2. Drops. Every gripper of every part whose instruction is `drop` opens.
3. Grabs. Every gripper of every part whose instruction is `grab` closes; a
   gripper over a mote that is not a fixture takes hold of that mote's
   constellation. A gripper over a fixture or over nothing closes on nothing.
4. Motion. The moving parts sweep across the cycle, as the next section
   defines, with the torn check at its start and the collision check at each
   sample.
5. Boundary. Motes are at rest on hex centers again. The boundary sequence
   runs: the sigil phase, then sets, then rises, then the completion check,
   then the area bank. `sim.cycle` increments and the next cycle begins.

## Motion and carrying

An instruction imposes a rigid motion over the cycle, parameterized by the
fraction `t` from `0` to `1`:

| Instruction | Motion of the part | Motion imposed on each held constellation |
| --- | --- | --- |
| `rotate-cw`, `rotate-ccw` | The part's direction turns 60 degrees about its base, clockwise or counterclockwise, sweeping `60 * t` degrees. | The same rotation about the base. |
| `pivot-cw`, `pivot-ccw` | The part does not move. | Rotation about the holding gripper's hex, sweeping `60 * t` degrees. |
| `extend`, `retract` | The piston's length changes by one, its gripper translating one hex along its spoke. | Translation by the same vector, linearly in `t`. |
| `advance`, `recede` | The base translates to the adjacent track cell, wrapping on a closed track. | Translation by the same vector, linearly in `t`. |
| `grab`, `drop`, blank | None. | None. |

A carried constellation moves as one rigid body: every mote of it follows the
motion, and at `t = 1` every mote lands exactly on a hex center, because every
motion carries hexes to hexes. A mote held by nothing rests on its hex for the
whole cycle. Fixtures are carried by their wheel's rotation and rest
otherwise.

Grips persist across cycles until dropped, and they ride the motion: after a
rotation the gripper is over the mote it holds at the new spoke hex, after a
pivot the held constellation has turned under the stationary gripper, and
after a piston or track translation both have moved together.

A mote may be carried over, dropped on, and rest on a hex off the field: a
gripper reaches anywhere. It collides, is grabbed, and is banked exactly as
on the field, and no sigil ever reaches it, because sigils are placed on the
field alone.

### Held more than once

A constellation may be held by several grippers at once, and the drop and grab
steps may create that freely. At the start of the motion step, every held
constellation's imposed motions must agree: each holding gripper imposes the
motion of its own part's instruction, and unless every imposed motion is the
same one, the run faults as `torn`. Motions agree when they are all no motion,
all the same translation vector, or all rotation about the same center in the
same direction. Two grippers of one rotating arm therefore agree, two arms
riding the same track in the same direction agree, and an arm that rotates
while another holds still tears the constellation.

## Collision

`COLLISION_SAMPLES` is `8`. Within the motion step, every mote's position is
evaluated at the sample fractions `t = k / 8` for `k` from `1` to `8`, in
order. If at any sample the centers of any two motes come within
`2 * MOTE_COLLIDE_R` (`38`) of one another, strictly, the run faults as
`collision` at that sample, naming the pair. Every pair is checked, fixtures
included; motes sharing one rigid motion keep their separation, so a
constellation never collides with itself.

The following worked examples pin the rule. Coordinates are the axial hexes of
`specs/field.md`, distances are in logical units rounded to two decimals, and
the threshold is `38`.

| # | Configuration | Nearest sampled approach | Outcome |
| --- | --- | --- | --- |
| A | An arm at `(0, 0)`, length 1, carries a mote from `(1, 0)` toward `(0, 1)` with `rotate-cw`. A mote rests on `(1, 1)`, the hex outside the swept corner. | `35.14` at `t = 4/8` | Faults. The carried mote passes between its start, its destination, and the resting mote, and the gap is too tight. |
| B | The same sweep, with the resting mote behind it on `(1, -1)`. | `53.33` at `t = 1/8` | Clear. The sweep moves away from it. |
| C | An arm at `(0, 0)`, length 2, carries a mote from `(2, 0)` toward `(0, 2)` with `rotate-cw`. A mote rests on `(1, 0)`, inside the sweep. | `48.81` at `t = 1/8` | Clear. A length 2 sweep clears the whole inner ring. |
| D | The same sweep, with the resting mote on `(1, 1)`, under the arc. | `12.86` at `t = 4/8` | Faults. The arc passes almost directly over that hex. |
| E | A piston extends, carrying a mote from `(1, 0)` to `(2, 0)`. A mote rests on `(2, -1)`, beside the path. | `41.57` at `t = 4/8` | Clear. A straight slide fits past a flanking mote, and past one on `(1, 1)` symmetrically. |
| F | The same slide, with the resting mote ahead on `(3, -1)`. | `48.00` at `t = 8/8` | Clear. The slide ends adjacent to it, exactly at rest separation. |
| G | Two arms swap two motes between `(1, 0)` and `(0, 1)`, one rotating clockwise about `(0, 0)` and the other clockwise about `(1, 1)`. | `12.86` at `t = 4/8` | Faults. The two arcs cross mid-cycle. |
| H | Two motes rest on `(0, 0)` and `(1, 0)`. Nothing moves. | `48.00` | Clear. Resting adjacency never collides. |
| I | A track arm advances east, carrying a mote from `(0, 0)` to `(1, 0)`. A mote rests on `(1, -1)`. | `41.57` at `t = 4/8` | Clear. The same corridor as E. |
| J | Two arms on one track both advance east, carrying motes on `(0, 0)` and `(1, 0)`. | `48.00` | Clear. A convoy keeps its separation. |
| K | Two arms rotate two motes along the same arc in opposite directions, from `(2, 0)` clockwise and from `(0, 2)` counterclockwise, both about `(0, 0)`. | `0.00` at `t = 4/8` | Faults. They meet head on. |

The table's middle column names each configuration's nearest sampled
approach, which is what decides clear from faulting. A faulting run halts at
the first sample strictly within `38`, which can precede the nearest
approach: example A first violates at `t = 3/8` at `36.10`, D and G at
`t = 1/8` at `37.16`, and K at `t = 3/8` at `25.06`, and each freezes there.

A move that ends on an occupied hex is not a separate rule: the final sample
finds the two motes at distance `0`.

## Faults

`FAULTS` names every way a run halts:

| Fault | Raised |
| --- | --- |
| `collision` | Two motes within `38` at a sample. |
| `torn` | A held constellation's imposed motions disagree. |
| `overextended` | `extend` on a piston already at length `3`. |
| `overretracted` | `retract` on a piston already at length `1`. |
| `unmounted` | `advance` or `recede` on a part not on a track. |
| `track-end` | `advance` at the last cell, or `recede` at the first cell, of an open track. |
| `impossible` | `extend` or `retract` on a part that is not a piston, or any instruction but `rotate-cw` or `rotate-ccw` on a wheel. |

A fault freezes the run where it stood: fetch-step and torn faults at the
cycle's start, a collision at its sample fraction. The status becomes
`faulted`, the parts and motes at fault are identified for the display
`specs/ui.md` describes, and nothing advances further. `back` returns to
editing.

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
before it left it, so a mote transmuted this boundary can be bound this
boundary, and a filament bound this boundary can be sundered this boundary.
Each sigil's condition and effect are in `specs/sigils.md`.

After the four waves, every set is evaluated, then every rise, each in the
same reading order. A set consumes every constellation it accepts before any
rise spawns, so a rise whose footprint a finished constellation covered can
fire at the same boundary the set clears it.

## Completion and metrics

After the rises, if every set's tally has reached the challenge's `target`,
the run completes: the status becomes `complete`, the `complete` cue plays,
and the metrics are recorded.

| Metric | Value |
| --- | --- |
| `cost` | The machine's cost, as `specs/parts.md` computes it. |
| `cycles` | `sim.cycle + 1` at the completing boundary: the number of cycles the machine ran. |
| `area` | The size of the area bank below. |

The area bank is a set of hexes accumulated across the run. At the start of
the run it takes every placed part's hexes, every fixture hex, and every
gripper hex at rest. After every boundary, the settle included, it takes the
hex of every mote and of every gripper. `area` is how many distinct hexes the
bank holds when the run completes.

Completing a challenge marks it solved, unlocks what its mode unlocks, and
updates the challenge's records: each of the three metrics is kept as the best
achieved over the session, independently, as `specs/modes/campaign.md` and
`specs/modes/extras.md` describe. The finished machine stays on screen behind
the panel `specs/ui.md` defines, and keeps animating its loop if the build
chooses, though nothing further is tallied.

## Determinism

The simulation is a function of the machine and the elapsed simulated time.
Cycle outcomes, collisions included, are computed from the machine's parts,
tapes, and the sample fractions, never from rendering, frame rate, or wall
time; a run advanced in one frame reaches exactly the state of the same run
advanced over many. The game uses no randomness anywhere. The full contract,
and the operations that drive a run from code, are in
`specs/instrumentation.md`.
