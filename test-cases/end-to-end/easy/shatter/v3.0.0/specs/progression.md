# Shatter — The run

This file defines the run: the ships the player has, what costs one, what a
respawn looks like, when the game ends, and the wave loop the field is filled by.
The score is in `specs/scoring.md`, and the screens the run moves between are in
`specs/ui.md`.

## A new game

A new game begins with `START_LIVES` (`3`) ships, counting the one being flown, a
score of `0`, and wave `1`. It begins on a field cleared of everything the
previous game left: no rock, no bullet, no saucer bullet, and no saucer. The ship
starts at the safe point as `specs/ship.md` states, and the saucer cadence starts
over from the beginning of the game.

## Lives

A ship is lost when it is destroyed by one of the three lethal contacts
`specs/collision.md` names: a rock, the saucer, or a saucer bullet. Losing a ship
costs one life. The star's core costs nothing.

When a ship is lost and lives remain, the next ship appears at rest at the safe
point `(SAFE_X, SAFE_Y)` = `(640, 560)` facing `FACE_UP`, with `INVULN_TIME`
(`2.5` seconds) of respawn grace. Through that window the ship is fully
controllable and ignores the three lethal contacts, and its drawn appearance shows
that the grace is running. Lethal contact resumes on the tick the grace reaches
`0`.

When the last ship is lost the life count reaches `0`, no new ship appears, and
the game is over.

## Waves

The game is an endless series of waves of rocks.

Wave `N` spawns `WAVE_BASE_ROCKS + N` (`3 + N`) Large rocks, so wave 1 puts up
four and wave 2 puts up five. Each is placed at a position drawn uniformly from
the points of the field at least `WAVE_MIN_SHIP_DIST` (`300`) from the ship and at
least `WAVE_MIN_STAR_DIST` (`200`) from the star, both by the shortest wrapped
separation, and set drifting in a direction drawn uniformly over the full turn.

Each rock's speed is a Large's base drift speed (`specs/rocks.md`) multiplied by

```
1 + min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (N - 1))
```

with `WAVE_SPEED_STEP` (`0.04`) and `WAVE_SPEED_CAP` (`0.4`), so wave 1's rocks
take the plain range, wave 6's are `20` percent faster, and every wave from 11
onward is `40` percent faster.

### Clearing a wave

A wave clears on the tick in which the last rock on the field is destroyed. It is
a transition, not a condition on the field: a field that holds no rocks and has
had none destroyed on that tick is a wave being played, not a wave cleared.

Destroying rocks is the only way a wave clears, since the star recycles rather
than removes.

### The banner

On the tick a wave clears, the wave number advances by one and a `WAVE N` banner
appears, naming the wave about to start. The banner runs for `WAVE_BANNER_TIME`
(`1.5` seconds), and the rocks it announces are spawned as it ends. No rock is on
the field at any point while the banner is showing.

Either opening is acceptable for wave 1: put the rocks up at once when the game
begins, or run the `WAVE 1` banner first and spawn as it ends. What is fixed is
the order within a banner, wherever one runs.

The banner is a breather rather than a pause. Only the rocks are held back: the
ship keeps flying under the player's control, timers keep running, and a saucer
already on the field keeps travelling, keeps firing, and can still be shot down.
