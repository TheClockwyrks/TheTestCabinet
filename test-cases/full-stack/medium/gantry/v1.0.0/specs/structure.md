# Gantry — Members, materials, and parts

This file defines what a crane is built from and the rules the editor enforces
on every edit. How the finished structure carries force is `specs/statics.md`;
how it is operated is `specs/program.md`.

## Members

A member is a straight element between two distinct lattice nodes, its ends
`a` and `b`. Members connect only where they share an end node: two members
whose segments cross in space are not joined there and pass through one another
freely. Each member carries a material, and its length `L` is the distance
between its ends.

| Material | Cost per unit | Mass per unit | Axial stiffness `EA` | Tension capacity | Compression capacity | Max length |
| --- | --- | --- | --- | --- | --- | --- |
| `strut` | `STRUT_COST_PER_UNIT` (`10`) | `STRUT_MASS_PER_UNIT` (`0.8`) | `STRUT_EA` (`300000`) | `STRUT_CAP_TENSION` (`2400`) | `STRUT_CAP_COMPRESSION` (`2400`), buckling-reduced | `STRUT_MAX_LEN` (`6`) |
| `cable` | `CABLE_COST_PER_UNIT` (`4`) | `CABLE_MASS_PER_UNIT` (`0.15`) | `CABLE_EA` (`60000`) | `CABLE_CAP_TENSION` (`3600`) | none: a cable goes slack | `CABLE_MAX_LEN` (`24`) |
| `rail` | `RAIL_COST_PER_UNIT` (`18`) | `RAIL_MASS_PER_UNIT` (`1.2`) | `RAIL_EA` (`300000`) | `RAIL_CAP_TENSION` (`2400`) | `RAIL_CAP_COMPRESSION` (`2400`), buckling-reduced | `RAIL_MAX_LEN` (`6`) |

A strut and a rail resist both tension and compression. Their compression
capacity falls with length: a member of length `L` bears compression up to its
compression capacity times `min(1, (BUCKLE_REF / L)^2)`, with `BUCKLE_REF`
(`4`), so a long strut buckles under a fraction of what a short one holds. A
cable resists tension only; in compression it goes slack and carries nothing,
as `specs/statics.md` states.

A rail is also the track the trolley runs on. Rail members are placed like any
other member, and the run of rail they form is the trolley's path, under The
rail below.

## Parts

### The slew ring

The slew ring is the bearing the arm turns on, and a crane has exactly one. It
is placed by its base corner, a lattice node `(x, y, z)`, and occupies eight
nodes: the bottom flange, the four nodes `(x, y, z)`, `(x + LATTICE_PITCH, y,
z)`, `(x, y, z + LATTICE_PITCH)`, and `(x + LATTICE_PITCH, y, z +
LATTICE_PITCH)`, and the top flange, the same four nodes at `y +
LATTICE_PITCH`. The slew axis is the vertical line through the flange square's
center, `(x + LATTICE_PITCH / 2, y, z + LATTICE_PITCH / 2)`.

The ring is rigid: each flange holds its four nodes fixed relative to one
another and to the other flange, and the ring turns the whole top flange about
the slew axis by the slew angle. It weighs `RING_MASS` (`20`), costs
`RING_COST` (`300`), and each of its eight flange connections carries force up
to `RING_CAP` (`6000`), as `specs/statics.md` states.

The ring divides the structure in two. Everything connected through members to
the top flange is the arm and turns with the slew angle; everything connected
to the bottom flange or to an anchor is the tower and stands still. Members
attach to flange nodes like any other node, tower members to the bottom flange
and arm members to the top.

### The trolley and the rail

The trolley is the carriage the hoist cable hangs from. It exists whenever the
structure has rail members and is not placed by hand; it costs nothing beyond
its rail and weighs `TROLLEY_MASS` (`15`).

The rail members must form a single straight track for it:

- Every rail member is horizontal: its two ends share a `y`.
- All rail members are collinear, along one line, and consecutive: ordered
  along that line, each shares an end node with the next, with no gap and no
  branch.
- Every rail member is in the arm.
- The track's two end nodes lie at distinct horizontal distances from the slew
  axis.

The end nearer the slew axis is the track's origin. The trolley's position is
its distance along the track from that origin, from `0` to the track's length,
and the trolley begins every run at `0`. The first rule is enforced the moment
a rail member is placed; the rest are checked whenever the structure is
readied, under Readiness below.

### Counterweights

A counterweight is a mass block hung on the structure: placed on any node the
structure uses, it adds `COUNTERWEIGHT_MASS` (`80`) at that node and costs
`COUNTERWEIGHT_COST` (`40`). A node carries at most one counterweight. Placed
on an arm node it balances the arm; placed on a tower node it simply weighs the
tower down.

### The hook

The hook is the crane's hand, hanging from the trolley on the hoist cable. It
weighs `HOOK_MASS` (`5`), is part of every crane, and is never placed or paid
for. `specs/rigging.md` owns everything it does.

## Cost and the budget

A crane's cost is the sum of its parts: each member's length times its
material's cost per unit, plus `RING_COST` for the ring, plus
`COUNTERWEIGHT_COST` per counterweight. Each site fixes a budget, and the cost
never exceeds it: an edit that would take the cost past the budget is refused.
The current cost and the budget are always on screen in the editor
(`specs/ui.md`).

## The editor's rules

The editor refuses any edit that would break a rule, and a refused edit changes
nothing. There is no error state to leave: the structure on screen always
satisfies every rule below.

A member placement is refused when:

- either end is outside the envelope, or the ends are the same node;
- its length exceeds its material's maximum;
- a member already joins the same two nodes, in either direction;
- its segment intersects an obstacle or dips below the ground plane (an end on
  the ground is allowed; only `y < 0` is below it);
- it is a rail member and is not horizontal;
- it would join the arm to the tower anywhere but through the ring: adding it
  would create a path of members between a bottom-flange or anchor node and a
  top-flange node;
- it would take the cost past the budget.

A ring placement is refused when the crane already has a ring, when any of the
eight flange nodes falls outside the envelope, when the base corner's `y` is
`0` (the ring sits on a tower, not on the ground), or when it would take the
cost past the budget. A counterweight placement is refused on a node no member
ends at, on a node already carrying one, or past the budget. Removing a member,
the ring, or a counterweight is always allowed; removal is how a structure that
the ring rule would otherwise trap is reshaped.

Deleting and undo round out the editor: a delete removes one member, the ring,
or one counterweight, and undo restores the structure to what it was before the
most recent structure-changing edit, as far back as the site was opened.
`specs/controls.md` states how both are driven.

## Readiness

Some rules concern the structure as a whole, so they are checked when the
structure is readied rather than on each edit: by the static check
(`specs/instrumentation.md`) and when a run starts (`specs/program.md`). Each
readiness issue has a stable identifier, reported wherever readiness is
reported:

| Issue | Meaning |
| --- | --- |
| `no-ring` | The crane has no slew ring. |
| `no-rail` | The crane has no rail members. |
| `invalid-rail` | The rail members break one of the track rules above. |
| `disconnected-members` | Some member belongs to neither the tower nor the arm: it has no member path to an anchor, a flange node, or the ring. |

A structure with no readiness issues is ready to run. Whether it stands is the
solve's verdict, not the editor's: a ready structure may still be a mechanism
or collapse under its first load, as `specs/statics.md` states.
