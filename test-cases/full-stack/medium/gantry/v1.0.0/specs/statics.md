# Gantry — Forces, the solve, and failure

This file defines how the structure carries force: the load model, the solve
that computes every member's force, slack cables, breakage, and the ways a run
ends in failure. It runs once per tick during a run, at the point in the tick
pipeline `specs/program.md` fixes, and once, statically, for the editor's check
(`specs/structure.md`).

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

Mass is lumped at nodes. Each node's mass is half of every intact member ending
at it, each half being the member's length times its material's mass per unit,
plus `COUNTERWEIGHT_MASS` for a counterweight on it, plus `RING_MASS / 8` for
each flange node of the ring. The trolley's `TROLLEY_MASS` sits at the trolley
point and is shared between the two nodes of the rail member the trolley is on,
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
the slew axis to the node's rotated position,

```
a = -omega^2 * r - alpha * (k x r)        with k = (0, 1, 0)
```

where `k x r` is the vector `(r.z, 0, -r.x)`. The first term is centripetal
and draws the node in toward the axis. The second is tangential and turns with
the arm: a positive `alpha` accelerates a node standing at `+x` of the axis
toward `+z`, the way a positive slew carries it.

The trolley point adds its own motion along the track: with `u` the track's
world direction (unit, origin end toward far end), `v` and `w` the trolley's
rate and acceleration along it,

```
a_trolley = -omega^2 * r - alpha * (k x r) + w * u - 2 * omega * (k x u) * v
```

where `k x u` is the vector `(u.z, 0, -u.x)`. The last term is the Coriolis
contribution of driving the trolley while the arm turns, and it runs the same
way as the tangential term: driving the trolley outward while the arm turns
from `+x` toward `+z` accelerates it toward `+z`. The cable force from
`specs/rigging.md` is applied at the trolley point and shared between the same
two rail nodes the trolley's mass is.

## The two solves

The ring is expressed by solving the arm and the tower separately and carrying
the arm's reactions across the ring. It contributes no stiffness to either
solve: what holds the arm is the top flange it is supported on, and what holds
the bottom flange is the tower's own members.

A solve's nodes are the ends of its intact members, together with the four
flange nodes the ring gives it: the top flange for the arm, the bottom flange
for the tower. A flange node belongs to its solve whether or not a member ends
there, since it carries ring mass and, on the bottom flange, the force carried
across. A node that no intact member ends at and no flange puts there belongs
to neither solve: a counterweight left on such a node applies nothing, and a
member joined to neither the arm nor the tower carries no force and no weight.
Both have fallen with what held them.

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
2. The tower solve. Nodes: the tower's, at their lattice positions. Supports:
   the anchor nodes. Applied forces: the tower's lumped masses, plus, at each
   bottom-flange node, the negated reaction read at the top-flange node it
   shares a ring corner with (`specs/structure.md`), which is how the arm's
   weight and overturning moment bear on the tower. The reaction crosses the
   corner as it was read, in world components, negated and turned no further.
   The corner pairing is the ring's own and holds at every slew angle.

Each corner carries the reaction at its top-flange node down to its
bottom-flange node, so the force at a corner's two flange connections has one
magnitude. That magnitude is checked against `RING_CAP` at each of the four
corners: it stays at or below it, and a tick on which one exceeds it ends the
run as `ring-overload`.

The two solves and the ring check run in a fixed order, and the first of them
to fail ends the run: the arm solve, whose singularity is a `collapse`; then
the ring check on the arm's reactions, whose excess is a `ring-overload`; then
the tower solve, whose singularity is a `collapse`. Only when all three pass
are utilizations read and breakage decided.

## Slack cables

Cables carry tension only, so each solve iterates to find which are taut. Solve
with every candidate cable present; every cable whose force comes back negative
goes slack, leaves the system entirely, and carries zero force; solve again
with the remainder. Repeat until a solve marks no new cable slack. A cable
marked slack stays out for the rest of that solve's iteration but is a
candidate again at the next solve, so a cable is slack per solve, never
permanently.

Going slack takes away a cable's stiffness and nothing else. A slack cable
still hangs there and still weighs: the lumped masses and the applied forces
are those of the whole intact structure, fixed before the iteration begins and
unchanged by it.

## Singularity

A structure that cannot resist its loads has no equilibrium: the supported
system `K u = F` is singular. The supported system is what is left once the
support rows and columns are gone, and it is symmetric, so it is factored
symmetrically and without pivoting: `K = L D L^T` with `L` unit lower
triangular and `D` diagonal, eliminating the unknowns in the order the system
holds them and exchanging no row and no column. The pivots are the diagonal
entries of `D`. The system is singular when a pivot's magnitude falls below
`SINGULAR_TOL` (`1e-8`) times the largest diagonal entry of that same
supported `K`, and the factorization stops there. A singular solve, in either
the arm or the tower, at any point in the slack-cable iteration or the
breakage sequence, ends the run as `collapse`. An under-braced 3D truss is the
ordinary way to get here: a flat frame with nothing resisting out-of-plane
motion is a mechanism even though every member is sound.

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
them are removed at once, permanently for the rest of the run. Both solves then
run again at the same tick, over the members still intact, with the lumped
masses and the applied forces recomputed for them, in the same order and under
the same checks. Repeat until a pass breaks nothing or a pass fails. Breakage
that leaves the structure standing plays the `break` cue and the run continues
without the broken members.

A rail member breaking can take the track out from under the trolley, which
ends the run as `collapse`. It does so in two cases:

- the trolley is on the broken member or beyond it, its position at or past
  that member's end nearer the track origin;
- the rails left no longer form a single track.

Being on a member and forming a track are as `specs/structure.md` defines them.
A break outboard of the trolley simply shortens the track, and the trolley
axis's range shortens with it (`specs/program.md`).

## Collisions

Collisions are tested once per tick, at the prescribed geometry. A body meets
an obstacle only where it reaches inside the box, as `specs/world.md` states,
so a member lying flush along an obstacle's face and a load set down flush on
its top are both clear of it:

- A member whose segment reaches inside an obstacle ends the run as
  `structure-struck-obstacle`. Members standing clear at build time can sweep
  into an obstacle as the arm turns; the test catches them tick by tick.
- An attached load whose box, at its current position and yaw, reaches inside
  an obstacle ends the run as `load-struck-obstacle`.
- An attached load whose box dips below the ground, its lift point's `y` minus
  its class height falling below `0`, ends the run as `load-struck-ground`.
  With no load attached, the hook point below `0` ends the run the same way. A
  load whose bottom face rests exactly on `y = 0` is on the ground, not through
  it.

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
