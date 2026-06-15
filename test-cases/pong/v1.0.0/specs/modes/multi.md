# Carom — Multi-ball mode

This file defines the **Multi-ball** mode, which sits alongside the standard
modes. It builds on the standard modes in `specs/modes/standard.md`, the geometry
in `specs/playfield.md`, the physics in `specs/physics.md`, and the match flow in
`specs/flow.md`.

## Menu entry

This mode spec adds the following entry to the main menu (see Game states in
`specs/flow.md`):

- `MULTI`

Place it after the standard `SOLO` and `VERSUS` entries and before `HOW TO PLAY`.

## Mode

- **Multi-ball** — same as **Solo** (human on the left versus the AI on the
  right, standard scoring and match flow, normal `1.04` speed multiplier with the
  `980 px/s` cap, and the same AI opponent from `specs/modes/standard.md`), but
  **three balls are in play at once** instead of one.

The mode label shown in the HUD (see `specs/flow.md`) during a Multi-ball match
is `MULTI`.

## Three balls

- Every ball is the standard ball from `specs/playfield.md`: a circle of **radius
  11** (diameter 22), with the same **520 px/s** serve speed, the same `1.04`
  speed multiplier per paddle hit clamped at the **980 px/s** cap, and the same
  spin mechanic from `specs/physics.md` applied independently per ball.
- Each ball carries its own velocity and its own spin scalar. Spin is imparted,
  decays, and curves each ball exactly as described in `specs/physics.md`, per
  ball and independent of the other balls.

## Serving three balls

- At the start of the match and after every point, all three balls spawn at the
  center `(640, 360)`, hold for the standard **1.0 s** countdown, then serve
  together. Stagger their serve directions so they do not overlap perfectly: give
  each ball a distinct vertical component within the **+/-30deg**-of-horizontal
  serve cone from `specs/playfield.md` (for example, one angled up,
  one roughly flat, one angled down). The horizontal direction of the serve
  follows the normal serve rule from `specs/flow.md` (toward the receiver / the
  player who was scored on), and all three balls serve toward that same side.
- Because the three balls spawn coincident at the center, the ball-to-ball
  collision below is suppressed for the duration of the countdown and resolved
  only once the balls have separated after the serve.

## Scoring with three balls

- A point is scored as soon as **any** ball fully passes a goal edge (`x < 0` or
  `x > 1280`), exactly as in `specs/flow.md`: the point goes to the player on the
  opposite side, and the next serve travels toward the player who was scored on.
- When a point is scored, the rally ends: **all three balls** are removed and
  re-served together as described above. Only one point is awarded per rally even
  if more than one ball would cross an edge on the same step; resolve the first
  ball to cross and end the rally immediately.
- Standard winning rules from `specs/flow.md` apply unchanged (first to 11, win
  by 2).

## Ball-to-ball collision

In addition to the wall, paddle, and obstacle collisions from
`specs/physics.md`, the balls must collide **with each other** as elastic
circles of equal mass:

- Two balls collide when the distance between their centers is less than the sum
  of their radii (`22`, since each radius is `11`). Resolve every colliding pair
  each physics step.
- On contact, exchange the velocity components **along the line connecting the
  two centers** (the collision normal), leaving the components **tangent** to
  that line unchanged. For equal masses this is the standard elastic swap of the
  normal velocity components. After resolving, push the two balls apart along the
  normal so they no longer overlap.
- Ball-to-ball collisions **do not change spin** and **do not change speed**
  beyond redistributing the existing velocities (speed is only changed by paddle
  hits, per `specs/physics.md`); each ball keeps its own spin scalar across the
  collision.
- Use swept collision or a small enough timestep so fast balls do not tunnel
  through each other, consistent with the no-tunneling requirement in
  `specs/physics.md`.
