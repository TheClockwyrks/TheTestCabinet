# Fathom — The predators

This file defines the predators in common: how they move, how the den releases them,
how a detection alert announces an acquisition, and how their numbers grow with
depth. Each kind's own sense, tell, and counter live in its own file:

- `specs/predators/lanternjaw.md` — the Lanternjaw, which hunts your light.
- `specs/predators/gloamfin.md` — the Gloamfin, which hunts your sound.
- `specs/predators/flarefish.md` — the Flarefish, which hunts in its flare's light.

It builds on the maze and den in `specs/maze.md`, the sensing and ink in
`specs/gameplay.md`, the movement in `specs/movement.md`, and the progression in
`specs/progression.md`.

There are exactly three kinds of predator, each keyed to a different signal you give
off. None of them can be eaten; there is no power-up that turns them into prey. The
only ways to survive are to stay undetected, to break their fix, and to out-maneuver
them.

## Shared movement and states

All predators move on the tile grid, along corridor centers, choosing a direction at
each junction. They travel at their own speeds (defined per kind). A predator may
reverse at any time; it does not have to wait for a tile center to turn around. When
a predator first detects you it is explicitly allowed to turn back toward you
immediately (called out in each kind's file), so it never wastes a beat facing the
wrong way at the moment it finds you.

Two shared ideas run under the per-kind behavior:

- Wander (patrol): it does not know where you are. At junctions it picks an open
  direction at random, preferring not to immediately reverse, so its path is
  unpredictable. It moves at its patrol speed.
- A fix: a tile it believes you are at, set by its sense. While it holds a fix it
  pursues, following the shortest corridor path to the fixed tile, rounding walls to
  reach it. It must genuinely path around obstacles: it follows the shortest corridor
  route to the fixed tile rather than only ever stepping in the direction that
  shortens the straight-line distance (which would walk it into the corner nearest you
  and let it get no closer). When a predator loses track of you (see each kind's
  file), the fix holds at your last-known tile and it paths there, rounding the corner
  you slipped behind rather than pressing into the wall between you.

Predators move through the wrap tunnel like the forager. Contact, a predator's body
overlapping the forager, costs a life (see `specs/progression.md`).

Render each from its provided sprite (`specs/assets.md`), facing its direction of
travel with its swim cycle: the Lanternjaw from `assets/lanternjaw/`, the Gloamfin
from `assets/gloamfin/`, the Flarefish from `assets/flarefish/`. Their two signature
effects, the sonar pulse and the flare bloom, are separate provided effect sheets,
called out in each kind's file. Do not draw substitute creatures or effects.

## Detecting you: the alert

Two of the predators can blindside you: the Gloamfin, which acquires you the instant
it takes a sound-fix by any of its paths (`specs/predators/gloamfin.md`), and the
Flarefish, which gives off no continuous tell and so can find you unseen, the moment
its flare catches you or the moment it drifts up on you and its ordinary light-sense
fixes on you (`specs/predators/flarefish.md`). The moment a predator acquires a fix in
one of these ways, play a clear detection alert so you always know you have been
spotted:

- A sharp, bright flash burst in that predator's signature color, centered on the
  predator, that snaps outward and fades over about `0.5 s`, together with the
  predator itself shown lit for that window, even where your own light does not reach,
  so you can see which hunter found you and roughly where it is.

The alert is runtime art you draw in code (see `specs/assets.md`; it is not a sprite
sheet), and it must be unmistakable against the dark, reading at a glance. The
Lanternjaw also hunts your light continuously, but it has no discrete alert: its
always-visible bulb (`specs/predators/lanternjaw.md`) is its standing tell, so you can
already see it coming. The Flarefish senses you the same continuous way, yet shows
nothing between flares, so even a quiet light-sense acquisition must fire the alert;
otherwise its unseen jaws would be a pure blindside.

## The den and release

All predators begin each maze (and respawn after you lose a life) inside the den
(`specs/maze.md`), and leave through the den gate on a staggered schedule, one after
another. They leave in a fixed order — the Lanternjaw first, then the Gloamfin, then
the Flarefish, then any additional predators in the order they were added (below) —
with each leaving `5 s` after the one before it. So the first Lanternjaw leaves
immediately (release time `0`), the first Gloamfin at `5 s`, the first Flarefish at
`10 s`, and each further predator `5 s` later again (`15 s`, `20 s`, and so on).

When you lose a life, all surviving predators return to the den and re-release on the
same schedule, giving you a moment to reorient.

The schedule is timed from live play. Release time `0` is the moment the dive
countdown ends and play begins, not the moment the countdown starts: the countdown
does not count against the schedule, and no predator leaves the den while it is
running. The same holds for the countdown after a life is lost — it is the start of
the moment you get to reorient, not part of it. So a dive always opens with the full
staggered release ahead of it, whatever the countdown's length.

## How many predators: deeper mazes add hunters

Deeper mazes are more dangerous because they hold more hunters, not faster ones
(predator speeds never change with depth; see `specs/progression.md`). The roster
grows with the depth `d`:

- The first maze (`DEPTH 1`) holds one of each: one Lanternjaw, one Gloamfin, one
  Flarefish.
- Each depth beyond the first adds one more predator, cycling through the kinds in the
  order Gloamfin, Lanternjaw, Flarefish. So `DEPTH 2` adds a Gloamfin (two Gloamfins,
  one Lanternjaw, one Flarefish); `DEPTH 3` adds a Lanternjaw (two Gloamfins, two
  Lanternjaws, one Flarefish); `DEPTH 4` adds a Flarefish (two of each).
- The roster stops growing after `DEPTH 4`: it holds at two of each (six predators)
  for every deeper maze. Depth still shrinks the sonar range
  (`specs/progression.md`); only the predator count is capped.

Every predator of a given kind behaves exactly as its own file describes; multiple
predators of the same kind each sense, hunt, and are countered the same way,
independently. They are added to the den in the order above and released on the
staggered schedule.

## Reading the three at once

Each predator answers to a different one of your signals: light (Lanternjaw), sound
(Gloamfin), flare-light (Flarefish), and each has a distinct tell and a distinct
counter. That is the puzzle of the dark: eat to progress but go dim near the
Lanternjaw, ping to see but not near the Gloamfin, exploit the Flarefish's light
without standing in it, and keep ink for the two that see. And read the amber glimmers
carefully: a drifter is points, but the one that looks just like it may be the
Lanternjaw's bulb.
