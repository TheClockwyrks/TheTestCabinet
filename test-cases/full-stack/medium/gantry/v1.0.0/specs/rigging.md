# Gantry — The hoist, the hook, and the swinging load

This file defines the rigging: the hoist cable and its pivot, the pendulum the
hook and load swing on, the cable's tension and snapping, attaching a load,
turning it with the grip, and setting it down. It advances once per tick during
a run, at the point in the tick pipeline `specs/program.md` fixes.

## The pivot and the bob

The hoist cable hangs from the pivot: the trolley point, on the rail track at
the trolley's position, rotated with the arm (`specs/statics.md`). Its length
is the hoist axis's value `L` (`specs/program.md`). What hangs at its end is
the bob: the hook alone, of mass `HOOK_MASS`, or the hook with the attached
load, of mass `HOOK_MASS` plus the load's mass. The hook point and the attached
load's lift point are both the bob's position.

The cable is inextensible: the bob stays at distance `L` from the pivot. It is
drawn from pivot to bob and is otherwise massless.

At the start of a run the bob hangs at rest directly below the pivot:
position the pivot minus `(0, L, 0)`, velocity zero.

## The pendulum tick

The bob carries a position `p` and a velocity `v`, updated every tick by the
following steps, in order, with `dt = 1 / TICK_HZ`, the tick's pivot `P` and
its previous position `P_prev`, and the tick's cable length `L`:

1. Gravity: `v = v + g * dt`, with `g = (0, -GRAVITY, 0)`.
2. Drift: `p = p + v * dt`.
3. Constraint direction: `n = (p - P) / |p - P|`; if `p` coincides with `P`,
   `n = (0, -1, 0)`.
4. Constraint position: `p = P + L * n`.
5. Pivot velocity: `vP = (P - P_prev) / dt`.
6. Constraint velocity, relative to the pivot: `vr = v - vP`, then remove the
   radial part, `vr = vr - dot(vr, n) * n`, then damp the swing,
   `vr = vr * (1 - SWING_DAMPING * dt)` with `SWING_DAMPING` (`0.05`).
7. Recompose: `v = vP + vr`.

On a run's first tick, `P_prev` is the pivot at the run's starting posture
(`specs/program.md`).

The bob's acceleration for the tick is `a = (v - v_prev) / dt`, with `v_prev`
its velocity at the end of the previous tick. On a run's first tick the
acceleration is zero, whatever velocity the steps above leave.

## Cable tension and snapping

The cable's tension vector is what the constraint applied to the bob:

```
T = m * (a - g)        with m the bob's mass
```

and the force the rigging applies to the structure at the pivot is `-T`, which
is the cable force `specs/statics.md` applies at the trolley point. Hanging at
rest this is the bob's weight, straight down; swinging, hoisting, and slewing
all show up in it.

A tick on which `|T|` exceeds `HOIST_CABLE_CAP` (`3000`) snaps the cable and
ends the run as `cable-snap`, whether or not a load is attached.

## The grip

The grip is the powered swivel in the hook, and its axis value is the hook's
yaw in degrees (`specs/program.md`). With a load attached, the load's yaw is
the grip's value: the grip turns the load, kinematically, about the vertical
line through the bob. Turning the grip applies no force to anything. With no
load attached the grip turns the bare hook, visibly and to no other effect.

## Attaching

`attach` is one of the tape's actions (`specs/program.md`). When it executes:

- The candidate is the `waiting` load whose lift point is nearest the hook
  point, ties going to the one the site lists first, if that distance is at
  most `ATTACH_RADIUS` (`0.8`).
- With no candidate, the run ends as `attach-missed`.
- With a candidate, the load becomes `attached`: the grip's axis value is set
  to the load's current yaw, so the hook seizes the load squarely and the
  load's yaw is thereafter the grip's value; the bob's mass includes the
  load's from this tick's pendulum step on, which runs later in the tick than
  the action does; and the bob's position and velocity carry on unchanged. The
  `attach` cue plays.

One load is attached at a time; `attach` while a load is attached ends the run
as `attach-missed`, since there is no free hook to attach with.

## Releasing

`release` is the other action. When it executes with a load attached, the
load's pose is judged against its own target pose:

| Test     | Bound                                                                                         |
| -------- | --------------------------------------------------------------------------------------------- |
| Position | distance from lift point to target position at most `PLACE_POS_TOL` (`0.5`)                   |
| Yaw      | the wrapped difference between load yaw and target yaw at most `PLACE_YAW_TOL` (`10`) degrees |
| Speed    | the bob's speed at most `PLACE_VEL_TOL` (`0.6`)                                               |

The wrapped difference between two yaws is the shorter way round the circle:
their difference in degrees brought into `0` up to but not including `360`,
then subtracted from `360` when it comes out above `180`. It is never negative
and never above `180`, so a load `2` degrees short of its target yaw and one
`2` degrees past it are both `2` degrees off.

If all three hold, the load is `placed`: it leaves the hook, sits at exactly
its target pose for the rest of the run, and the `placed` cue plays. The bob's
mass drops back to the hook's from this tick's pendulum step on, and its
position and velocity carry on unchanged.

If any test fails, the load is dropped and `lost`, and the run ends as
`release-misplaced`. `release` with nothing attached ends the run the same
way. What a dropped load does on screen is presentation; the verdict is
already decided.
