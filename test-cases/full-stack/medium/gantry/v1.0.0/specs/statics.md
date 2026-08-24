# Gantry — Forces, the solve, and failure

This file defines how the structure carries force: the load model, the solve
that computes every member's force, slack cables, breakage, and the ways a run
ends in failure. It runs once per tick during a run, at the point in the tick
pipeline `specs/program.md` fixes, and once, statically, for the editor's check
(`specs/instrumentation.md`).

The structure is analyzed as a pin-jointed truss under small elastic
displacement: members carry axial force only, joints transmit force and no
moment, and each solve is a linear equilibrium at the current prescribed
geometry. The prescribed geometry is what moves: node positions come from the
lattice, the slew rotation, and nothing else. Elastic displacements are a
readout for drawing and never feed back into positions, velocities, or the next
tick.

## Geometry at a tick

Tower nodes stand at their lattice positions. Arm nodes turn with the slew
angle: with the slew axis through `(ax, ·, az)` and `theta` the slew value,
converted to radians for these formulas, a node placed at `(x, y, z)` stands
at

```
x' = ax + (x - ax) * cos(theta) - (z - az) * sin(theta)
z' = az + (x - ax) * sin(theta) + (z - az) * cos(theta)
y' = y
```

so a positive `theta` turns `+x` toward `+z`, matching yaw in
`specs/world.md`. The rail track, the trolley point, and the pivot the cable
hangs from all follow this rotation.

## The load model

Mass is lumped at nodes. Each node's mass is half of every member ending at it,
each half being the member's length times its material's mass per unit, plus
`COUNTERWEIGHT_MASS` for a counterweight on it, plus `RING_MASS / 8` for each
flange node of the ring. The trolley's `TROLLEY_MASS` sits at the trolley point
and is shared between the two nodes of the rail member the trolley is on,
linearly by its position along that member; at a shared node it belongs wholly
to that node. The hook and any attached load reach the structure only through
the cable force below.

Each lumped mass `m` at a point with prescribed acceleration `a` applies the
force

```
F = m * g - m * a        with g = (0, -GRAVITY, 0)
```

at its node. Tower nodes have `a = 0`. An arm node's acceleration comes from
the slew motion: with `omega` and `alpha` the slew rate and acceleration in
radians per second and per second squared, and `r` the horizontal vector from
the slew axis to the node,

```
a = -omega^2 * r + alpha * (k x r)        with k = (0, 1, 0)
```

The trolley point adds its own motion along the track: with `u` the track's
world direction (unit, origin end toward far end), `v` and `w` the trolley's
rate and acceleration along it,

```
a_trolley = -omega^2 * r + alpha * (k x r) + w * u + 2 * omega * (k x u) * v
```

The last term is the Coriolis contribution of driving the trolley while the
arm turns. The cable force from `specs/rigging.md` is applied at the trolley
point and shared between the same two rail nodes the trolley's mass is.

## The two solves

The ring's rigidity is expressed by solving the arm and the tower separately
and carrying the arm's reactions across the ring.

Each solve is the standard direct stiffness method over its members. Every
node has three displacement unknowns. A member from node `p` to node `q` with
world direction `n` (unit, `p` toward `q`) and length `L` contributes the
stiffness `(EA / L) * n * n^T` coupling its two ends, assembled into the
system `K u = F` with `F` the applied nodal forces above. Support nodes are
held at zero displacement and their rows and columns leave the system. The
member's axial force is then

```
N = (EA / L) * dot(u_q - u_p, n)
```

positive in tension, negative in compression.

1. The arm solve. Nodes: the arm's, at their rotated positions. Supports: the
   four top-flange nodes. Applied forces: the arm's lumped masses under their
   accelerations, and the cable force at the trolley point. Each support's
   reaction is read back: the reaction at a support node is minus the sum of
   the applied force there and every member force pulling on it.
2. The tower solve. Nodes: the tower's. Supports: the anchor nodes. Applied
   forces: the tower's lumped masses, plus, at each bottom-flange node, the
   negated reaction read at the top-flange node directly above it, which is
   how the arm's weight and overturning moment bear on the tower.

The eight ring connections are checked against `RING_CAP`: the magnitude of
each top-flange reaction, and of each force carried across to the bottom
flange, stays at or below it, and a tick on which one exceeds it ends the run
as `ring-overload`.

## Slack cables

Cables carry tension only, so each solve iterates to find which are taut. Solve
with every candidate cable present; every cable whose force comes back negative
goes slack, leaves the system entirely, and carries zero force; solve again
with the remainder. Repeat until a solve marks no new cable slack. A cable
marked slack stays out for the rest of that solve's iteration but is a
candidate again at the next solve, so a cable is slack per solve, never
permanently.

## Singularity

A structure that cannot resist its loads has no equilibrium: the supported
system `K u = F` is singular. Detect it during factorization: a pivot whose
magnitude falls below `SINGULAR_TOL` (`1e-8`) times the largest diagonal entry
of the assembled `K` marks the system singular. A singular solve, in either the
arm or the tower, at any point in the slack-cable iteration or the breakage
sequence, ends the run as `collapse`. An under-braced 3D truss is the ordinary
way to get here: a flat frame with nothing resisting out-of-plane motion is a
mechanism even though every member is sound.

## Utilization and breakage

Every member's utilization is its force against its capacity:

```
utilization = N / capacityTension          when N >= 0
utilization = -N / capacityCompression(L)  when N < 0
```

with the compression capacity length-reduced as `specs/structure.md` states,
and a slack cable's utilization `0`. Utilization is the readout the run screen
colors members by (`specs/ui.md`).

After both solves, every member whose utilization exceeds `1` breaks: all of
them are removed at once, permanently for the rest of the run, and both solves
run again at the same tick. Repeat until a pass breaks nothing or a solve goes
singular. Breakage that leaves the structure standing plays the `break` cue
and the run continues without the broken members; a rail member breaking while
the trolley has any part of its span on it ends the run as `collapse`, since
the track has fallen out from under the trolley.

## Collisions

Collisions are tested once per tick, at the prescribed geometry:

- A member whose segment intersects an obstacle ends the run as
  `structure-struck-obstacle`. Members standing clear at build time can sweep
  into an obstacle as the arm turns; the test catches them tick by tick.
- An attached load whose box, at its current position and yaw, intersects an
  obstacle ends the run as `load-struck-obstacle`.
- An attached load whose box dips below the ground, its lift point's `y` minus
  its class height falling below `0`, ends the run as `load-struck-ground`.
  With no load attached, the hook point below `0` ends the run the same way.

The hook, the cable, waiting loads, and placed loads collide with nothing, and
the structure never collides with itself or with a load.

## The failure causes

Every failed run carries exactly one cause, the first the tick pipeline
reached, from this fixed vocabulary. The causes in this file:

| Cause | Meaning |
| --- | --- |
| `collapse` | A solve went singular, or the trolley's track broke under it. |
| `ring-overload` | A ring connection exceeded `RING_CAP`. |
| `structure-struck-obstacle` | A member swept into an obstacle. |
| `load-struck-obstacle` | The carried load hit an obstacle. |
| `load-struck-ground` | The carried load, or the empty hook, hit the ground. |

`specs/rigging.md` and `specs/program.md` contribute the rest: `cable-snap`,
`attach-missed`, `release-misplaced`, `command-out-of-range`, and
`loads-unplaced`. `specs/ui.md` gives each cause its screen copy.
