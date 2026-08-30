# Towers

## Overview

This file defines the eight towers, six emitters that fire and the two movers (Forge
and Sink) that only shift heat, their stats, footprint sizes, radiator layouts, and
thermal personalities, and how you build, rotate, upgrade, and sell them. It builds
on the floor in `specs/playfield.md`, the heat system in `specs/heat.md`, the controls
in `specs/controls.md`, and the economy in `specs/economy.md`. Ranges are in tiles
(one tile = 19 px, `specs/playfield.md`); heat figures use the `0..100` scale of
`specs/heat.md`.

The stat numbers below are fixed; implement them exactly as written. Equally
important is the behavior: the heat-to-damage plateau, the per-tower redline, the
trip, surface cooling through radiator faces, conduction, and each tower's stance.

## Footprints, sizes, and radiator faces

Towers come in three sizes, 2x2, 3x3, and 4x4 tiles, and a tower occupies a snapped
footprint of its size (`specs/playfield.md`). A bigger tower hits harder but, because
it sheds heat only through its perimeter while it generates heat across its whole
body, runs hotter for the same firing and wants open air, corner placement, or Sinks
(`specs/heat.md`).

Each emitter designates some faces as radiator faces (cyan fins, `specs/heat.md`)
that shed heat far better than plain faces. Radiators are given in the tower's local
(un-rotated) orientation and turn with the tower's placement rotation, which is
chosen while the tower is held and fixed once it is placed (`specs/controls.md`).
Movers have no radiator faces.

## Shared targeting rules

- An emitter automatically fires at surge units in range; there is no manual trigger.
  A tower's Range is the radius in tiles measured from the center of its footprint; a
  unit within that radius is targetable.
- By default an emitter targets the in-range unit furthest along its path to an
  exhaust (the standard "first" target), ground or flying. Splash and anti-air differ
  as noted.
- Each emitter fires at its fire rate (shots/second) whenever it has a target, adding
  `heatPerShot / mass` per shot and dealing `baseDamage * heatMultiplier(H, redline)`
  per shot (`specs/heat.md`). With no target it only cools.
- The Arc, Stutter, Lance, Bloom, and Rime can target both ground units and flyers.
  The Flak is air-only. The Forge and Sink never target anything.
- This targeting is shown in each tower's info, both the shop-hover info panel and the
  selected-tower inspector (`specs/controls.md`): every emitter but the Flak reads as
  hitting ground and air, the Flak reads air-only, and the movers read as never
  firing.

## Emitters

| Tower | Size | Role / stance | Cost | Range | Fire rate | Base dmg | heatPerShot | Redline | Mass | Radiators (local) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Arc | 2x2 | Basic, balanced, the cheap maze/chip tower | 15 | 6.0 | 2.0 /s | 6 | 10.3 | 80 | 1.0 | N, S |
| Stutter | 2x2 | Rapid fire, twitchy, low redline, trips easily | 40 | 5.0 | 7.0 /s | 2.0 | 4.2 | 60 | 0.5 | N, E |
| Rime | 2x2 | Cryo slow, heat-averse | 45 | 5.5 | 2.4 /s | 4 | 7.0 | 100* | 1.1 | N, S, E |
| Flak | 2x2 | Anti-air only, dedicated flyer counter | 60 | 8.0 | 2.6 /s | 6 | 9.6 | 78 | 0.9 | N, S |
| Bloom | 3x3 | Area splash, big, heavy, runs hot | 150 | 6.0 | 1.2 /s | 10 | 27.3 | 82 | 1.8 | N, E |
| Lance | 4x4 | Long-range sniper, heavy, high redline, wants feeding | 150 | 12.0 | 0.8 /s | 43 | 48.9 | 92 | 2.8 | N, E |

`*` The Rime is heat-averse and has no damage plateau; its redline is the 100 trip,
and it slows best cold (below).

Notes on the ones with special behavior:

- Arc is the workhorse and the cheapest tower. At 15 it is the one you lay down in
  numbers to shape the maze and chip the surge, the way the maze is meant to be
  built. With 2 radiator faces (N/S) and a redline of 80, a well-placed Arc, two or
  more faces on the open lane and radiators aimed there, settles right in its 80..100
  plateau, hot but online. Box it in and it trips. Forgiving; the tower to learn on.
- Stutter pours on heat fast and has a low mass (0.5), so it is the twitchiest
  emitter, spiking to the trip on any busy lane. Its low redline (60) is the mercy:
  it reaches full power early and has a wide, forgiving plateau to spike around in. It
  is the clearest "wants a Sink" tower, and beside one it holds a continuous stream
  of fire.
- Lance is a 4x4 sniper: a huge hit at long range, but a low firing heat for its
  bulk, so on an open lane it runs cold and hits near its 0.35x floor. Its high
  redline (92) means it only reaches full power run very hot, and a 4x4 cannot shed
  much heat once its faces are covered, so the way to arm it is to feed it: tuck it so
  its faces are blocked, or park a Forge on it (only a maxed Forge, setpoint 96,
  drives it into its 92+ plateau). Its high mass (2.8) then holds it steady up there.
  The clearest "wants a Forge / wants tucking" tower.
- Bloom is a 3x3 splash tower: it damages all surge within 2.4 tiles of its shot's
  impact (targets the in-range unit furthest along, and splashes around it). Its
  heavy `heatPerShot` and 3x3 body mean it runs hot in a packed chokepoint and wants
  a corner (three open faces) or a Sink to stay in its 82..100 plateau without
  tripping.
- Flak is the dedicated anti-air tower (`specs/surge.md`): it targets flyers only.
  Flak is how the player buys reliable air coverage without pulling ground damage off
  the maze.

### Rime

The Rime does not deal meaningful damage; it slows the surge, and it works best cold.
Its slow strength falls as it heats:

```
slowFactor(H) = slowCeil * (1 - H / 100)
```

A hit applies a movement slow of `slowFactor(H)` (a fraction of normal speed removed)
for 1.5 s, refreshed by further hits; slows do not stack beyond the strongest
currently applied. So a cold Rime (`H` near 0) cuts a unit's speed by up to `slowCeil`
(55% at level I); a Rime run hot does almost nothing. It has 3 radiator faces (N/S/E)
so it is easy to keep cold in open air, but its own firing warms it, and conduction
from hot neighbors or a Forge cooks it (`specs/heat.md`). Keep a Rime in open air or
beside a Sink, away from Forges and hot cores. Some surge units are immune to slowing
entirely (`specs/surge.md`): the Rime's slow is not applied to them, and it targets them
under the shared rules above like anything else.

## Forge and Sink

The Forge and Sink are 2x2, never fire, and have no heat of their own; they shift
heat to and from the emitter faces that touch them (`specs/heat.md`).

| Tower | Effect on each touching emitter | Cost |
| --- | --- | --- |
| Forge | Thermostat: warms toward a setpoint (72 at level I), never past it | 20 |
| Sink | Coolant loop: adds 16 (level I) cooling per shared edge, proportional to heat | 20 |

- The Forge adds `0.9 * sharedEdgeTiles * max(0, setpoint - H)` heat per second. It
  only ever pushes an emitter up to its setpoint, so it cannot trip a firing gun on
  its own. It wakes cold guns and feeds the Lance; keep it off anything you want
  cold.
- The Sink adds `sinkOutput * sharedEdgeTiles * (H / 100)` cooling per second, the
  only way to cool a boxed-in tower, since it cools through a face that would
  otherwise be blocked. Sinks stack. Use them to brake hot guns, hold a dense core in
  its plateau, and shield a Rime.

Both are walls (`specs/playfield.md`) and a face touching a mover sheds no heat to air.
Multiple movers touching one emitter stack their effect.

## Building, rotating, upgrading, and selling

- Build. Buy a tower from the shop and place its `size x size` footprint on open floor
  (`specs/controls.md`). Its cost is deducted from your money (`specs/economy.md`);
  you cannot build what you cannot afford. Placement obeys the mazing rules in
  `specs/playfield.md` (never seal the floor).
- Rotate. An emitter can be rotated in 90-degree steps only while it is held, before
  placing. The held preview rotates, turning its radiator faces so you can aim them at
  the open lane before you commit (`specs/heat.md`, `specs/controls.md`). Once a tower
  is placed its orientation is fixed; a placed tower cannot be rotated. Re-aiming a
  built tower means selling it and building a fresh one. Movers have no faces and do
  not rotate.
- Upgrade. A selected tower can be upgraded through three levels, I, II, III. Each
  level applies, on top of the previous:
  - Emitters: `baseDamage * 1.6`, `range + 1.0` tiles, `fireRate * 1.15`, and
    `heatPerShot * 1.3` (it heats faster; a maxed emitter is a glass cannon that needs
    more thermal support). Size, redline, mass, and radiator layout are unchanged. The
    Rime instead raises its cold-slow ceiling (0.55 -> 0.68 -> 0.80) along with range
    and `heatPerShot`.
  - Movers: the Forge's setpoint rises 72 -> 84 -> 96; the Sink's per-edge cooling
    rises 16 -> 24 -> 36. Size and footprint unchanged.
  - Cost. Upgrading to II costs 1.0x the build cost; to III, 1.8x. (For an Arc: 15 to
    reach II, 27 to reach III.)
- Sell. A selected tower sells for a 70% refund of everything spent on it (build plus
  upgrades), rounded down, except a tower sold during the same build phase it was
  placed on, before that wave has started, which refunds its full spend (100%, no
  rounding loss). A tower that has never participated in a wave can always be undone
  for a full refund; the 70% refund only applies once the wave it was placed on has
  run. This matters most during the untimed opening build phase before Wave 1
  (`specs/gameplay.md`): freely place, re-shape, and sell back your opening layout
  without penalty. A tower placed on an earlier wave and merely upgraded this build
  phase has already fought, so it, upgrades included, is back to the 70% refund.
  Selling reopens every tile in its footprint immediately and the surge re-paths
  (`specs/playfield.md`).

Upgrading and selling happen through the selected-tower inspector in the build panel;
rotation happens only on the held preview before placing (`specs/playfield.md`,
`specs/controls.md`).
