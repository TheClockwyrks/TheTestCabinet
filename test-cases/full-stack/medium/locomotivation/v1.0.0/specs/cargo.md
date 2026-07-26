# Locomotivation — the freight

Freight is what the shift is about: color-matched packages the worker hauls from a
source to a matching drop zone. This file defines the package colors, weight
classes, the three archetypes, delivery, and the drop and destruction rules.
Numbers are initial values; implement them as named constants. Per-level
counts and placements are in `specs/levels.md`.

## Colors

Freight comes in four colors: Red, Blue, Green, Amber. A package's color is its
whole identity for routing: it can be delivered only to a drop zone of the same
color. Color reads at a glance from the package sprite and matches its dispenser
and zone (`specs/overview.md` palette).

## Weight classes

Every package is one of three weight classes (its weight in carry-capacity units;
`W_max = 120`, `specs/character.md`):

| Class | Weight | Effect alone | Effect of combining |
| --- | --- | --- | --- |
| Parcel | `30` | 25% of cap, full speed | two Parcels = 50% (edge of full speed) |
| Crate | `55` | 46% of cap, full speed | Parcel + Crate = 71%, slowed, sprint still on |
| Load | `80` | 67% of cap, slowed, sprint still on | Parcel + Load = 92%, crawling, sprint locked |

So the worker can hold two Parcels, or a Parcel and a Crate, or a single Load,
comfortably; but a second heavy item tips past the 80% line into the sprint-locked
crawl, and some combinations exceed the cap and are refused. Choosing a load is a
speed-vs-trips wager on every pickup (`specs/character.md`). A package's class is
independent of its color and its archetype.

## The three archetypes

Every package is exactly one of these. The archetype decides what happens when it
is lost (destroyed on a track, or destroyed by dying while carrying it):

### Unique (required, loss fails the level)

A one-of-a-kind package. There is exactly one, it does not replenish, and it must
be delivered to its matching zone to complete the shift. Losing a unique package
fails the level immediately (`specs/flow.md`); it is the run's white-knuckle haul,
and the reason dying while carrying one is fatal to the shift regardless of lives.
A level has zero, one, or several uniques (`specs/levels.md`); a level with none is
a pure time-and-quota shift. Uniques read as distinctive, marked packages (a
stamped or sealed crate).

### Dispenser (required, replenishing quota)

A dispenser is a source station of one color and weight class that always has a
package ready. The worker takes the package at the dispenser; the dispenser then
emits a fresh one after a short delay (`DISPENSER_REFILL = 1.5` s), so there is
always another to fetch. A dispenser drives a quota: deliver X of that color to its
matching zone to satisfy it (`specs/levels.md` sets X per dispenser).

Because a taken or destroyed package is always replaced, a dispenser quota can
never soft-lock: losing a dispenser package to a train costs only a walk-back and
time, never the run. This is the forgiving baseline that keeps the shift clock the
master pressure (`specs/flow.md`). The worker may pull several from a dispenser over
the shift; only the count delivered matters.

### Optional (score only)

Optional packages are scattered freight worth score but not required for
completion. Delivering one adds to the score (`specs/flow.md`); losing one costs
only that potential score and nothing else. Optionals are the greed layer, the
reason to take an extra crossing or carry a heavier load, and they do not replenish.

## Pickup and delivery

- Pickup: the worker lifts a package (a dispenser's ready package, or a unique or
  optional lying in the yard) when standing on or adjacent to it and pressing the
  pick-up key, if it fits under `W_max` (`specs/character.md`). A dispenser hands
  over its ready package and begins its refill.
- Delivery: walking a carried package into its color-matched drop zone delivers it:
  it leaves the carried set, the matching quota's delivered count (or the unique's
  delivered flag, or the score) updates, and a delivery burst VFX and confirm sound
  fire (`specs/assets.md`). Entering a zone delivers all carried packages of that
  color at once; other colors stay carried. Delivering into the wrong color zone
  does nothing (the zone ignores non-matching freight).

## Drop and destruction

- Drop (`specs/controls.md`, `specs/character.md`) sets the most-recently carried
  package down at the worker's tile, or the nearest free adjacent tile.
- A package resting on Ground, Refuge, or a drop-zone or other safe tile is safe
  and retrievable: pick it back up later. This makes stage-and-relay a real tactic:
  drop a heavy package in a refuge, cross empty and fast, and come back for it.
- A package resting on a Track or Bridge tile is destroyed the instant a train car
  passes over it: the package is removed and the cargo-splinter particle burst (the
  required VFX, `specs/assets.md`) fires at its position with a crunch sound. Trains
  destroy cargo without slowing; a train is never blocked or diverted by freight.
- Death-drop: dying under a train destroys every package the worker was carrying in
  that same collision (`specs/character.md`), each firing the splinter VFX.

The consequence of a destruction depends on the archetype: a dispenser package is
replaced (only time lost); an optional is simply gone (score lost); a unique loss
fails the level (`specs/flow.md`).
