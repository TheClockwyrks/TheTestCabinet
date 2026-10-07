# Fathom — The Flarefish

The Flarefish hunts light and shows nothing of itself between the flares it casts.
This file defines its sense, its flare, the lock the flare gives it, its chase, and
the states it moves between. What every predator shares is in
`specs/predators.md`. Every figure below carries the name this specification gives it.

Outside a flare the Flarefish produces no light, no wavefront and no glow of its own,
so between flares it is drawn only where the forager's light, a sonar mark, or a flare
falls on it. It reports `hearingRange` and `hearingLock` as `null`.

## Sense: light, in a straight line

The Flarefish senses the forager on any step where all three of these hold at once.

| The condition    | What it means                                                                         |
| ---------------- | ------------------------------------------------------------------------------------- |
| In range         | The distance between the two centers is at most `R`, the Flarefish's detection range. |
| In line of sight | The straight line between the two centers crosses no rock tile.                       |
| Clear of ink     | That same line crosses no ink cloud, and the Flarefish itself stands in none.         |

`R` grows with the forager's brightness `G` on the same curve the Lanternjaw's does:
`R = LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * G`, `128` (4 tiles) at `G = 0` and `320`
(10 tiles) at `G = 1`. The snapshot reports its current value as `detectRange`.

This sense runs whatever the Flarefish is doing and owes nothing to the flare, so a
Flarefish that simply drifts up on a lit forager takes a fix at once and pursues. While
it senses the forager, the fix is the forager's current tile, refreshed every step, and
it reports `state` as `"chase"`.

## The flare

A wandering Flarefish carries a flare timer. The timer runs down only while the
Flarefish is wandering with no flare in progress, and when it reaches `0` the flare
begins:

1. Charge-up, for `FLARE_CHARGE` (`0.5 s`). A charge-up glow builds on the Flarefish,
   telegraphing the flare and giving its position away. `flareCharging` is true for this
   window.
2. Bloom, for `FLARE_BLOOM` (`1 s`), starting the moment the charge-up ends. `flaring`
   is true and `flareRadius` is `FLARE_RADIUS` (`192`, 6 tiles) for this window.

When the bloom ends the flare's sense and its light are over: `flaring` is false and
`flareRadius` is `0`, and a short fade of the bloom art plays out from that moment,
lighting nothing. The timer restarts at `FLARE_INTERVAL` (`7 s`) as the bloom ends, so
consecutive charge-ups begin `8.5 s` apart while the Flarefish keeps wandering.
Outside a flare, `flareCharging` and `flaring` are false and `flareRadius` is `0`.

While the bloom burns it lights a disc of radius `FLARE_RADIUS` centered on the
Flarefish and moving with it. The flare ignores rock: every tile whose center lies
inside the disc is revealed and drawn at full light, floor and wall alike, straight
through any rock between, and every predator and drifter inside the disc is drawn live
for as long as the bloom lasts. `specs/sensing.md` governs how the disc reads once the
bloom ends.

The flare is drawn from the provided flare-bloom effect sheet as its own overlay
centered on the Flarefish and scaled well past the creature's own sprite, playing the
charge, bloom and fade beats `specs/assets.md` lays out.

## The flare lock

The bloom is a sense as well as a light, and it reaches far past the ordinary one. On
any step of the bloom where the distance between the two centers is at most
`FLARE_RADIUS`, and neither the forager nor the line between them lies in ink and the
Flarefish stands in none, the Flarefish takes a fix on the forager's current tile, fires
the detection alert, and chases from that moment. The bloom ends at once when it locks
on.

The lock holds across the whole bloom rather than at its opening instant.

## Chase, losing the forager, and re-arming

A chasing Flarefish neither charges nor blooms, so it gives off no tell at all while it
hunts. Its chase follows the same rules as the Lanternjaw's: while the sense holds, the
fix is the forager's current tile; when the sense lapses the fix holds at the last tile
it sensed the forager on, `state` stays `"chase"`, the Flarefish paths there and holds
for `LINGER_TIME` (`2 s`), and sensing the forager again inside that window resumes the
chase without a fresh alert. Ink drops the fix at once with no linger, for as long as
the cloud blinds it.

Returning to `"wander"`, by the linger running out or by ink, sets the flare timer to
`FLARE_INTERVAL` in full, so the next flare is a whole interval away and the forager has
a window to get clear.

## Speed

The Flarefish travels at `PREDATOR_SPEED` (`116`) in every state, the Lanternjaw's
hunting pace.

## States

| From       | To         | When                                                               |
| ---------- | ---------- | ------------------------------------------------------------------ |
| `"den"`    | `"wander"` | It has swum out of the den chamber after its release time.         |
| `"wander"` | `"chase"`  | Its light-sense holds the forager, or its bloom locks on.          |
| `"chase"`  | `"chase"`  | Its light-sense holds the forager, or the linger is still running. |
| `"chase"`  | `"wander"` | `LINGER_TIME` runs out with nothing sensed, or ink blinds it.      |

The Flarefish never reports `state` as `"search"`.
