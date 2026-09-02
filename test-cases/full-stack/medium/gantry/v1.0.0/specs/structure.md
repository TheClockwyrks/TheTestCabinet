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

The ring is a bearing: it turns the arm and it carries force. It turns the top
flange about the slew axis by the slew angle and takes the whole arm with it,
so an arm node stands at its lattice position turned by that angle and nothing
else moves it, while the bottom flange stands still. Force crosses between the
flanges corner by corner, and that is the only path between the arm and the
tower. The ring holds nothing else: it adds no stiffness of its own, so the
arm's equilibrium is supported on the top flange and the bottom flange is held
by nothing but the members that reach it, both as `specs/statics.md` states.
The ring weighs `RING_MASS` (`20`), costs `RING_COST` (`300`), and each of its
eight flange connections carries force up to `RING_CAP` (`6000`).

The ring has four corners, and each corner is a pair of flange nodes: a
bottom-flange node and the top-flange node at the same `x` and `z`, the one
directly over it in the build pose. A corner pairs the same two nodes for the
life of the crane. The top flange turns and the bottom flange does not, so a
corner's two nodes stand over one another at slew `0` and not at a general slew
angle; the pairing is the ring's, not a reading of where the nodes currently
are. Force crosses the ring corner by corner, as `specs/statics.md` states.

The ring divides the structure in two. Everything connected through intact
members to the top flange is the arm and turns with the slew angle; everything
connected to the bottom flange or to an anchor is the tower and stands still.
Members attach to flange nodes like any other node, tower members to the bottom
flange and arm members to the top.

### The trolley and the rail

The trolley is the carriage the hoist cable hangs from. It exists whenever the
structure has rail members and is not placed by hand; it costs nothing beyond
its rail and weighs `TROLLEY_MASS` (`15`).

The rail members must form a single straight track for it:

- Every rail member is horizontal: its two ends share a `y`.
- All rail members are collinear, along one line, and cover one unbroken
  stretch of it exactly once: no two rails overlap and no gap is left between
  them. They therefore meet end to end, each sharing an end node with the next,
  and a track of `n` rails runs over `n + 1` nodes, two of them its ends.
- Every rail member is in the arm.
- The track's two end nodes lie at distinct horizontal distances from the slew
  axis.

The end nearer the slew axis is the track's origin. The trolley's position is
its distance along the track from that origin, from `0` to the track's length,
and the trolley begins every run at `0`. The trolley is on a rail member when
its position lies between that member's two ends along the track, both ends
included, so at a node two rail members share it is on both. The first rule is
enforced the moment a rail member is placed; the rest are checked whenever the
structure is readied, under Readiness below. The last two rules speak of the
arm and the slew axis, and a crane without a ring has neither, so the track is
judged only on a crane that has one: with no ring the track rules go unchecked
and `invalid-rail` is not raised. A crane that has a ring and no rail members
raises `no-rail` alone, for the same reason from the other side: with no rails
there is no track to judge, so no track rule is broken.

### Counterweights

A counterweight is a mass block hung on the structure: placed on any node the
structure uses, a node a member ends at or a flange node of the ring, it adds
`COUNTERWEIGHT_MASS` (`80`) at that node and costs `COUNTERWEIGHT_COST` (`40`).
A node carries at most one counterweight. Placed on an arm node it balances the
arm; placed on a tower node it simply weighs the tower down. What holds it is
the structure at that node, so a counterweight left with nothing at its node
falls, as `specs/statics.md` states.

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
- its segment reaches inside an obstacle (`specs/world.md`);
- it is a rail member and is not horizontal;
- it would join the arm to the tower anywhere but through the ring: adding it
  would create a path of members between a bottom-flange or anchor node and a
  top-flange node;
- it would take the cost past the budget.

A ring placement is refused when:

- the crane already has a ring;
- any of the eight flange nodes falls outside the envelope;
- the base corner's `y` is `0`, since the ring sits on a tower, not on the
  ground;
- it would join the arm to the tower anywhere but through the ring: with the
  ring in place, some path of members would run between a bottom-flange or
  anchor node and a top-flange node;
- it would take the cost past the budget.

A counterweight placement is refused on a node the structure does not use, on a
node already carrying one, or past the budget. Removing a member, the ring, or
a counterweight is always allowed; removal is how a structure that the ring
rule would otherwise trap is reshaped.

Deleting and undo round out the editor: a delete removes one member, the ring,
or one counterweight, and undo restores the structure to what it was before the
most recent structure-changing edit, as far back as the site was opened.
`specs/controls.md` states how both are driven.

## Readiness

Some rules concern the structure as a whole, so they are checked when the
structure is readied rather than on each edit: by the static check below and
when a run starts (`specs/program.md`). Each readiness issue has a stable
identifier, reported wherever readiness is reported:

| Issue | Meaning |
| --- | --- |
| `no-ring` | The crane has no slew ring. |
| `no-rail` | The crane has no rail members. |
| `invalid-rail` | The crane has a ring and rail members, and they break one of the track rules above. |
| `disconnected-members` | Some member belongs to neither the tower nor the arm: it has no member path to an anchor or to a flange node. |

A structure with no readiness issues is ready to run. Whether it stands is the
solve's verdict, not the editor's: a ready structure may still be a mechanism
or collapse under its first load, as `specs/statics.md` states.

## The static check

The `check` action on the build screen (`specs/ui.md`) reads the structure as
it stands, without starting a run. It reports:

| What it reports | Changes with |
| --- | --- |
| The issues that would refuse a run: the readiness issues above, and `empty-program` for an empty tape (`specs/program.md`) | The structure and the tape |
| The crane's cost, and the site's budget it is measured against | The structure |
| Whether the structure stands | The structure |
| Each intact member's force and utilization, in member-id order (`specs/state.md`) | The structure |

The result the action leaves stands until the structure or the tape changes,
when it goes back to none. The build screen shows it until then, so what is
shown always describes the crane and the tape on screen.

With any readiness issue the structure is not solved. Otherwise the two solves
of `specs/statics.md` run at the run-start posture `specs/program.md` fixes,
`slew` `0`, `trolley` `0`, `hoist` `HOIST_START`, and `grip` `0`, with the
bare hook hanging at rest and nothing moving, and the structure stands when
both solves are regular. A structure that is not solved does not stand,
whether a readiness issue refused the solve or a solve went singular, and it
reports no member at all: the member list is empty exactly when the structure
does not stand. A ready structure is solved whether or not it has a tape, so
`empty-program` on its own still reports the forces and the verdict.

Nothing breaks and nothing fails during a check: a utilization above `1` is
reported and no more.
