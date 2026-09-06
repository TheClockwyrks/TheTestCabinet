# Fathom — The predators

This file defines what every predator does in common: how it moves through the maze,
how it wanders, how it pursues a fix, the alert it fires when it finds the forager,
the den schedule that lets the hunters out, and how many hunters a depth holds. Each
kind's own sense, tell, speeds and state transitions are in its own file:
`specs/predators/lanternjaw.md`, `specs/predators/gloamfin.md`, and
`specs/predators/flarefish.md`. Every figure below carries the name this
specification gives it.

There are three kinds of predator, each keyed to a different signal the forager gives
off.

## Movement on the grid

A predator travels along the center lines of the corridors of the tile grid
`specs/overview.md` fixes. It is always heading in one of the four cardinal
directions or standing still, and the snapshot reports that heading as `dir`. Its
motion is continuous rather than tile by tile: tile centers are the points at which
it may change direction. A turn onto a perpendicular direction happens at a tile
center; a reversal onto the opposite direction is allowed at any point of a tile.

The snapshot reports a predator's current speed as `speed`, in logical units per
second. Each kind's file fixes what that speed is in each of its states, and no speed
in this specification changes with depth. A predator crosses the wrap tunnel exactly
as the forager does, leaving one edge and entering the other at the same speed
without stopping.

Contact with the forager costs a life, as `specs/gameplay.md` defines.

### Predators keep to the corridors

A predator stands only on a tile it may enter: an open corridor tile, and, while it
is in the den, a den tile or the den gate. Every position it occupies, in every state
and at every moment, lies on such a tile. Two consequences are requirements in their
own right.

- A predator holding a fix rounds the rock between it and the fixed tile. Each
  step it takes is the first step of a shortest corridor route from its tile to that
  tile, so it takes the way around an obstacle even while the direction that shortens
  the straight line to the fix is rock.
- A predator standing on a tile with no open neighbor stays on that tile, however
  long it stands there.

## Wander

A predator with no fix wanders, reports `state` as `"wander"`, and travels at its own
patrol speed. At each junction it picks at random among the open directions leading
out of it, preferring a direction other than an immediate reverse whenever one is
open.

## The fix and the chase

A fix is a tile a predator believes the forager is on. Each kind's sense sets it, and
each kind's file states when the fix is set, whether it then follows the forager, and
how it lapses. While a predator holds a fix it reports `state` as `"chase"` and
pursues the fixed tile, taking the first step of a shortest corridor route to it on
every step of the way.

A predator may reverse the instant it acquires a fix, wherever it stands on its
tile.

## The detection alert

The moment a Gloamfin or a Flarefish acquires a fix it was not already chasing on, it
fires a detection alert. For `ALERT_TIME` (`0.5 s`) from that moment the snapshot reports
`alert` as true for that predator, and the predator is drawn lit for that whole
window, wherever it stands and whatever the fog would otherwise hide of it. Refreshing
a fix a predator is already chasing on is not an acquisition and fires nothing, while
a predator that gives up a fix and later finds the forager again fires the alert
again.

The alert is drawn in code rather than from a sheet: a sharp flash burst in that
predator's own color, centered on the predator, snapping outward and fading over the
window. It reads at a glance against the dark and identifies the hunter that fired
it.

The Lanternjaw fires no alert. It carries a standing tell of its own instead, and its
file defines it, so its `alert` is false at every moment.

## The den and the release schedule

Every predator of the roster starts each maze inside the den `specs/maze.md` fixes and
leaves through the den gate on a staggered schedule. Each predator has a release time,
measured from the moment live play begins. The first predator's release time is `0 s`
and each one after it is `DEN_RELEASE_GAP` (`5 s`) later, so the roster's release times
are `0 s`, `5 s`, `10 s`, `15 s`, and so on in turn.

The order is `DEN_ORDER`: the Lanternjaw first, then the Gloamfin, then the Flarefish,
then every further predator of the roster in the order the roster adds it. A predator
waiting its slot reports `released` false and `state` `"den"`, holds a den tile, and is
drawn nowhere. When its release time arrives, `released` becomes true and it swims
across the chamber and out through the gate; it reports `state` `"den"` until it is out
of the chamber and `"wander"` from then on.

The schedule runs on live play alone. Release time `0` is the moment the dive countdown
ends and `screen` becomes `"playing"`, so the countdown counts against nothing and no
predator leaves the den while one is running. Losing a life returns every predator to the
den unreleased, and the whole schedule runs again from the moment play resumes.

`DEN_RELEASE_GAP` is the spacing between **release times**, not between arrivals in the
corridor. `released` is the schedule itself, and `state` leaving `"den"` is the swim
that follows it.

## The roster: how many hunters a depth holds

A maze's roster is fixed by its depth `d`, a whole number from `1`. Depth `1` holds one
of each kind. Each depth beyond the first adds one more predator, cycling the kinds in
the order `ROSTER_ADD_ORDER`: a Gloamfin, then a Lanternjaw, then a Flarefish. From
`ROSTER_CAP_DEPTH` (`4`) on the roster holds at `ROSTER_CAP`, two of each kind and six
predators in all, for every deeper maze.

| `depth`        | Lanternjaw | Gloamfin | Flarefish | Release order                   |
| -------------- | ---------- | -------- | --------- | ------------------------------- |
| `1`            | 1          | 1        | 1         | Lanternjaw, Gloamfin, Flarefish |
| `2`            | 1          | 2        | 1         | the above, then a Gloamfin      |
| `3`            | 2          | 2        | 1         | the above, then a Lanternjaw    |
| `4` and deeper | 2          | 2        | 2         | the above, then a Flarefish     |

An added predator takes the next den slot after the ones already there, so its release
time is `DEN_RELEASE_GAP` later than the previous predator's, and the snapshot lists the
roster in that same release order. Depth changes nothing else about a predator: the
senses, ranges, speeds and timings each kind's file fixes are the same at every depth,
and every predator of a kind senses and hunts exactly as that kind's file describes,
independently of the others.

## Drawing a predator

Each predator is drawn from its own provided sprite sheet, facing its direction of
travel and playing its swim cycle: the Lanternjaw from `assets/lanternjaw/`, the
Gloamfin from `assets/gloamfin/`, and the Flarefish from `assets/flarefish/`, as
`specs/assets.md` lays them out. A predator's body is drawn only while it is lit this
instant, which the snapshot reports as `lit`: by the forager's own light, by a live
sonar mark, by a flare, or by its own detection alert. Between those glimpses the body
is not drawn, wherever the predator is.

The sonar wavefront and the flare bloom are effects in their own right rather than part
of a creature, and the file of the kind that produces each states when it shows.
