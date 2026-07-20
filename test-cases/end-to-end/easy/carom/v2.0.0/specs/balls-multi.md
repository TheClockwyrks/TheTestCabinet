# Carom — Balls and serving

Three balls are in play at once. Each is the ball from `specs/playfield.md`, a
circle of radius 11 with serve speed 520 and a 1.04 speed multiplier per paddle
hit up to the 980 cap, and each carries its own velocity and its own spin scalar.
Spin is imparted, decays, and curves each ball exactly as `specs/physics.md`
describes, independently per ball.

The three balls do not start, reset, or score as a group. Each ball is its own
independent contest: when one ball leaves the field it resets and relaunches on
its own while the other two keep playing without interruption.

## Spawn points

Each ball has a fixed home point on the centerline (`x = 640`), spaced down the
field, and always returns to its own home point:

- Ball 1: `(640, 180)`, 25% of the field height.
- Ball 2: `(640, 360)`, 50% (the field center).
- Ball 3: `(640, 540)`, 75%.

## The per-ball countdown and serving

Each ball has its own countdown timer, independent of the others.

- At the start of the match, all three balls sit at their home points and each
  begins a `1.0 s` countdown; when a ball's countdown reaches `0`, that ball
  launches. Because they start together, all three launch together at match
  start.
- While a ball is counting down it is held motionless at its home point, but it is
  solid: it behaves as an immovable round body, so any moving ball that reaches it
  bounces off (see Ball-to-ball collision) while it waits. It does not move and it
  does not launch early from being struck; it launches only when its own countdown
  elapses.
- When a ball launches it is shot out at a uniformly random angle over the full
  360deg, at the 520 px/s serve speed. The launch angle is random every time and
  does not depend on where the ball was, which side scored, or the other balls;
  the two obstacles and the walls turn any launch direction into live play. This
  applies to the initial serve and to every relaunch alike.

## Scoring and independent respawn

- A point is scored the moment a ball fully passes a goal edge (`x < 0` or
  `x > 1280`), exactly as `specs/flow.md` describes: the point goes to the player
  on the opposite side and increments their score.
- Only the ball that crossed is affected. It is removed from play, returned to its
  own home point, and begins a fresh `1.0 s` countdown (held solid, as above);
  when that countdown elapses it relaunches at a new random 360deg angle. The other
  two balls carry on uninterrupted, and the field is not frozen.
- The match ends as `specs/flow.md` describes, first to 11 points and winning by
  at least 2. Points from all three balls accumulate into the same two scores.

## Ball-to-ball collision

In addition to the wall, paddle, and obstacle collisions in `specs/physics.md`,
the balls collide with each other as elastic circles of equal mass:

- Two balls collide when the distance between their centers is less than 22, the
  sum of their radii. Resolve every colliding pair each physics step, including a
  moving ball against a ball held at its home point during its countdown.
- On contact between two moving balls, exchange the velocity components along the
  line connecting the two centers (the collision normal), leaving the tangential
  components unchanged, then push the two balls apart along the normal so they no
  longer overlap.
- A ball held for its countdown is immovable: a moving ball that reaches it
  reflects its own velocity about the contact normal and is pushed clear, while
  the held ball stays put and its countdown is unaffected.
- Ball-to-ball collisions do not change spin, and they do not change speed beyond
  redistributing the existing velocities (only paddle hits change speed, per
  `specs/physics.md`). Each ball keeps its own spin scalar across the collision.
- Fast balls never tunnel through each other, consistent with `specs/physics.md`.

## The AI with three balls

In Solo the AI (`specs/modes.md`) faces three balls at once. It defends the ball
that most immediately threatens its goal, such as the nearest ball currently
moving toward it, rather than trying to cover all three, and it stays as beatable
as `specs/modes.md` requires. Balls getting past it are a fair way for the player
to score.
