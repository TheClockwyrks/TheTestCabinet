# Shatter — The rocks and the saucer

This file defines the drifting rocks you shoot and the enemy saucer that hunts you:
their geometry and behavior. How they move under gravity and how they collide are in
`specs/simulation.md`; scoring, waves, and the saucer's spawn cadence are in
`specs/rules.md`.

## The rocks

Rocks are the drifting debris you shoot. Each rock is one of three sizes; every size
is drawn as an irregular angular polygon (`specs/overview.md`) but collides as a
circle of the radius below.

| Size   | Collision radius | Base drift speed (px/s) | Score when destroyed |
| ------ | ---------------- | ----------------------- | -------------------- |
| Large  | 46               | 60–110                  | 20                   |
| Medium | 26               | 90–150                  | 50                   |
| Small  | 14               | 130–210                 | 100                  |

- A rock drifts under momentum, curved continuously by the star's gravity
  (`specs/simulation.md`), and wraps at the edges. Each rock also rotates slowly for
  visual life; the spin is cosmetic and does not affect collision.
- A rock's base drift speed is the speed it is spawned with, picked within the size's
  range. Gravity then speeds it up and slows it down as it falls toward and climbs
  away from the star, so its instantaneous speed varies.
- Splitting. When a bullet destroys a rock (`specs/simulation.md`), a Large rock
  becomes two Medium rocks, a Medium becomes two Small, and a Small is removed
  entirely. Splitting is the only way to reduce the number of rocks on the field.
- Health. Whether a rock takes a single bullet hit or several before it is destroyed
  is set by `specs/mode.md`. Splitting and scoring are unchanged by that rule, and a
  rock created by a split enters at full health for its size.
- Star recycling. When a rock is pulled into the star and its circle reaches the
  core, that rock is removed from the core and immediately re-placed at the same
  size. The replacement enters from off-screen: pick a random point just outside one
  of the four edges, place the rock there, and set it moving inward into the field at
  that size's base drift speed (a fresh speed within the size's range), so a rock
  recycled again and again never keeps accelerating. No points are scored, and the
  field's rock count is unchanged: the star churns the board but never empties it. In
  an armored mode, what health a recycled rock carries is set by `specs/mode.md`.

## The saucer

An enemy saucer periodically enters the field to hunt the ship.

- The saucer is drawn as a flattened neon disc, a classic flying-saucer silhouette,
  in color `#ff5c8a`, and collides as a circle of radius 18.
- The saucer is a powered craft: it is the one enemy body the star does not pull
  (`specs/simulation.md`), and it steers to avoid the star's core, never overlapping
  it.
- Cadence. At most one saucer exists at a time. The first appears about 18 seconds
  into a game, and thereafter a new one appears every 25 to 35 seconds while the ship
  is alive and in play.
- Movement. The saucer enters at a random `y` from the left or right edge and crosses
  the field horizontally at about 140 px/s, changing its vertical direction every
  second or so to weave, and wrapping top and bottom. It steers to avoid the star's
  core. It despawns after it has crossed roughly 1.5 field widths or after about 12
  seconds, whichever comes first.
- Firing. Every about 1.6 seconds the saucer fires one saucer bullet aimed at the
  ship's current position, with up to ±10 degrees of random aim error. A saucer
  bullet leaves at 300 px/s (plus the saucer's velocity), has a 1.4 s lifetime, is
  pulled by gravity, wraps, is absorbed by the star core, and harms only the ship
  (`specs/simulation.md`).
- Reward. Destroying the saucer with a bullet scores 200 points and removes it.
