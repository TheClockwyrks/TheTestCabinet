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
a value outside its axis's range at that moment ends the run as
`command-out-of-range`.

The trolley's range is the one that moves during a run: its upper bound is the
track's current length (`specs/structure.md`), and a rail breaking mid-run
shortens the track. A `trolley` target that was inside the range while an
earlier step ran is out of range when its own step starts if the track has
since fallen short of it, and a `trolley` command already running is judged
again the same way at the top of every tick: the first tick that finds the
track no longer reaching its target ends the run as `command-out-of-range`,
before any axis moves. Both checks read the track the rail members still intact
form at the moment the check is made, so a rail breaking on one tick has
shortened the range by the top of the next.

## Axis motion

A commanded axis moves under a per-tick controller: it accelerates at its
axis's fixed acceleration toward its commanded rate, cruises, and brakes at
that same acceleration to stop at the target. Per tick, for an axis with
position `x`, signed velocity `v`, target `T`, commanded rate `r`, and
acceleration `a`, with `dt = 1 / TICK_HZ`, `d = T - x`, and `s = sign(d)`,
which is `-1`, `0`, or `+1` and is `0` exactly when `x` is already `T`:

1. Brake or drive: if `v * s > 0` and `|d| <= v * v / (2 * a)`, brake,
   `v = v - s * a * dt`; otherwise drive, `v = v + s * a * dt` clamped to
   `[-r, +r]`.
2. Advance: `x = x + v * dt`.
3. Arrive: if `s * (T - x) <= 0`, the advance reached or crossed the target;
   set `x = T`, `v = 0`, and the command is done.

`s` is the sign of the distance to go at the top of the tick, and step 3 tests
that same `s` against the advanced `x`. A command whose target is the axis's
current value therefore has `s` of `0`: the axis neither brakes nor
accelerates, it does not move, and step 3 finds it arrived, so the command is
done on the tick it is issued.

The axis's acceleration for the tick, the figure the inertial loads in
`specs/statics.md` read, is the controller's own term. A tick that arrives
reports `0`, whether it braked or drove on the way in. Otherwise a braking
tick reports `-s * a`, a driving tick that changed `v` reports `+s * a`, and a
cruising tick, one whose clamp left `v` as it was, reports `0`. An axis with
no live command reports `0` and holds its value with zero rate. The controller
is exact and deterministic: the same tape over the same structure produces the
same motion tick for tick.

## The tick pipeline

During a run, each tick performs the following, in order. The first failure a
tick reaches ends the run with that cause and the later stages of that tick do
not run. A tick that ends the run counts like any other, whatever stage it
reached and whether it ended cleared or failed, so the run clock the run ends
on is that tick's own number over `TICK_HZ`.

1. The tape: a live move step whose axes have all arrived completes, and a
   live `trolley` command whose target the track the intact rails now form no
   longer reaches ends the run as `command-out-of-range`. If no step is live,
   this tick takes the next one: an action step executes (`specs/rigging.md`),
   a move step issues its commands to their axes. A tick that finds no live
   step and no step left to take is the tick the run ends on: cleared if every
   load is `placed`, otherwise failed as `loads-unplaced`. It runs none of the
   stages below.
2. Axis motion: advance every commanded axis under the controller above.
3. Geometry: the track, from the rail members that remain
   (`specs/structure.md`), then the arm rotation, the trolley point, and the
   pivot, as `specs/statics.md` states. Rails that no longer form a track
   leave the trolley nowhere to run, and the run ends as `collapse`.
4. Rigging: the pendulum tick, the cable tension, and the snap check
   (`specs/rigging.md`).
5. Collisions: members, the load, and the ground (`specs/statics.md`).
6. The solves (`specs/statics.md`), in this order: the arm solve, with its
   slack-cable iteration and its singularity test; the ring check on the
   reactions that solve reads back; the tower solve, with the same iteration
   and the same test; then every member's utilization and the breakage it
   calls for. A pass that breaks members runs the whole stage again over the
   members that remain, until a pass breaks nothing.
7. Readouts and cues: utilizations for the run screen, the `creak` rule and
   the `motor` loop (`specs/ui.md`), and the run clock, `tick / TICK_HZ`
   seconds.

A tick takes at most one step from the tape. A move step's axes arrive during
a tick's axis motion, and the step is found complete at the top of the tick
after that, which is the tick that takes the step following it. An action step
is taken, executed, and complete on one tick, and the step after it is taken
on the next, so two actions in a row occupy two ticks and never one. The
tape's last step is no different: the run ends at the top of the first tick
that finds it complete and no step left to take, so a final action step's own
tick runs in full and the tick after it is the one that ends the run.

## Starting and ending a run

A run starts from the build or program screen through the `run` action
(`specs/controls.md`). Starting is refused, with the issues listed and no run
begun, when the structure has a readiness issue (`specs/structure.md`) or the
tape is empty (`empty-program`). A refused start leaves the player where they
were.

A started run plays the `run-start` cue, moves to the run screen, and ticks
until it ends; `specs/state.md` fixes what the start leaves and which tick is
the run's first. The player watches at any of `RUN_SPEEDS` (`1`, `2`, `4`) times
real time; speed changes how many ticks a second of watching covers and
nothing else. The `back` action aborts a run early and returns to the build
screen; an aborted run has no verdict.

A run that ends cleared records the site's score, the crane's cost and the run
clock at the tick it ended on, and moves to the results screen. A failed run
stays on the run screen with its cause read out and the scene as it stood, so
the player reads what went wrong before going back to edit. Either way the
structure, the tape, and the loads' starting poses are untouched: every run
begins from the same authored state, and running is always repeatable.
