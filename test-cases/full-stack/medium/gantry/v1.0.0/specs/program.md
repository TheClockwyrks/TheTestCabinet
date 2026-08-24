# Gantry — The instruction tape and the run

This file defines the crane's four axes, the tape that commands them, the
per-tick motion each command produces, and the life of a run from `run-start`
to cleared or failed.

## The axes

| Axis | Value | Range | Max rate | Acceleration |
| --- | --- | --- | --- | --- |
| `slew` | the arm's angle, degrees | unbounded | `SLEW_MAX_RATE` (`30`) deg/s | `SLEW_ACCEL` (`30`) deg/s² |
| `trolley` | distance along the track from its origin, units | `0` to the track length | `TROLLEY_MAX_RATE` (`4`) u/s | `TROLLEY_ACCEL` (`4`) u/s² |
| `hoist` | the cable length, units | `HOIST_MIN` (`1`) to `HOIST_MAX` (`40`) | `HOIST_MAX_RATE` (`4`) u/s | `HOIST_ACCEL` (`6`) u/s² |
| `grip` | the hook's yaw, degrees | unbounded | `GRIP_MAX_RATE` (`45`) deg/s | `GRIP_ACCEL` (`90`) deg/s² |

Every run starts from the same posture: `slew` `0`, the build pose;
`trolley` `0`, the track origin; `hoist` `HOIST_START` (`2`); `grip` `0`. The
slew angle is a plain number rather than a wrapped one, so `360` is a full turn
past `0` and a tape may wind the arm around as often as it likes.

## The tape

The tape is an ordered list of steps, edited on the program screen
(`specs/ui.md`, `specs/controls.md`) and executed in order, one at a time. A
step is one of:

- A move: one or more commands, at most one per axis. A command is
  `{ axis, target, rate }`: drive that axis to the absolute `target` at up to
  `rate`. The step's commands run together, and the step is done when every
  one of its axes has arrived and stopped.
- An action: `attach` or `release`, exactly as `specs/rigging.md` defines
  them. An action executes on a single tick.

The tape editor accepts a command only with a rate greater than `0` and at
most the axis's max rate, and a move only with at least one command. Targets
are accepted as written: whether a target is reachable depends on the
structure, so it is judged when the step starts. A step whose command targets
a value outside its axis's range at that moment, a `trolley` target beyond the
track's length included, ends the run as `command-out-of-range`.

## Axis motion

A commanded axis moves under a per-tick controller: it accelerates at its
axis's fixed acceleration toward its commanded rate, cruises, and brakes at
that same acceleration to stop at the target. Per tick, for an axis with
position `x`, signed velocity `v`, target `T`, commanded rate `r`, and
acceleration `a`, with `dt = 1 / TICK_HZ`, `d = T - x`, and `s = sign(d)`:

1. Brake or drive: if `v * s > 0` and `|d| <= v * v / (2 * a)`, brake,
   `v = v - s * a * dt`; otherwise drive, `v = v + s * a * dt` clamped to
   `[-r, +r]`.
2. Advance: `x = x + v * dt`.
3. Arrive: if `s * (T - x) <= 0`, the advance reached or crossed the target;
   set `x = T`, `v = 0`, and the command is done.

The axis's acceleration for the tick, the figure the inertial loads in
`specs/statics.md` read, is the controller's own term: `+s * a` on a driving
tick that changed `v`, `-s * a` on a braking tick, and `0` on a cruising tick
(the clamp left `v` as it was), an arrival tick, and for an axis with no live
command, which holds its value with zero rate. The controller is exact and
deterministic: the same tape over the same structure produces the same motion
tick for tick.

## The tick pipeline

During a run, each tick performs the following, in order. The first failure a
tick reaches ends the run with that cause and the later stages of that tick do
not run.

1. The tape: if no step is live, take the next one; execute an action step
   (`specs/rigging.md`), or issue a move step's commands to their axes. A move
   step already live whose axes have all arrived completes, and the next step
   is taken on this same tick. After the last step completes, the run ends:
   cleared if every load is `placed`, otherwise failed as `loads-unplaced`.
2. Axis motion: advance every commanded axis under the controller above.
3. Geometry: the arm rotation, the track direction, the trolley point, and
   the pivot, as `specs/statics.md` states.
4. Rigging: the pendulum tick, the cable tension, and the snap check
   (`specs/rigging.md`).
5. Collisions: members, the load, and the ground (`specs/statics.md`).
6. The solves: forces, the ring check, slack cables, singularity, and
   breakage (`specs/statics.md`).
7. Readouts and cues: utilizations for the run screen, the `creak` rule and
   the `motor` loop (`specs/ui.md`), and the run clock, `tick / TICK_HZ`
   seconds.

## Starting and ending a run

A run starts from the build or program screen through the `run` action
(`specs/controls.md`). Starting is refused, with the issues listed and no run
begun, when the structure has a readiness issue (`specs/structure.md`) or the
tape is empty (`empty-program`). A refused start leaves the player where they
were.

A started run plays the `run-start` cue, moves to the run screen, and ticks
until it ends. The player watches at any of `RUN_SPEEDS` (`1`, `2`, `4`) times
real time; speed changes how many ticks a second of watching covers and
nothing else. The `back` action aborts a run early and returns to the build
screen; an aborted run has no verdict.

A run that ends cleared records the site's score, the crane's cost and the run
clock at the final tick, and moves to the results screen. A failed run stays
on the run screen with its cause read out and the scene as it stood, so the
player reads what went wrong before going back to edit. Either way the
structure, the tape, and the loads' starting poses are untouched: every run
begins from the same authored state, and running is always repeatable.
