# Carom — Playfield, paddles, obstacles, and ball

This file defines the geometry of the field and the objects in it. All positions
and sizes are in the logical-pixel coordinate system from `specs/overview.md` (a
fixed `1280 x 720` play area, origin top-left).

## Playfield

- The field spans the full `1280 x 720` area.
- The top wall (`y = 0`) and bottom wall (`y = 720`) are solid, and the ball
  reflects off them.
- The left and right edges are goals. A ball passing `x < 0` scores for player
  two (right); a ball passing `x > 1280` scores for player one (left).
- A dashed center net is drawn at `x = 640` for decoration and has no collision.

## Paddles

- Each paddle is a rounded bar 16 wide by 110 tall.
- The left (player one) paddle occupies `x` in `[48, 64]`. The right (player two
  or AI) paddle occupies `x` in `[1216, 1232]`.
- A paddle moves only vertically. Its center `y` is clamped to `[55, 665]` so the
  paddle stays fully on the field.
- A paddle moves at a constant 720 logical px/s while a movement key is held and
  is otherwise stationary. Its actual vertical velocity this step drives the spin
  mechanic in `specs/physics.md`.

## Obstacles

Two obstacles sit in the field. Each is a rounded bar 20 wide by 140 tall, placed
mirror-symmetrically through the field center `(640, 360)` so neither side is
favored:

- Obstacle A is centered at `(490, 220)`.
- Obstacle B is centered at `(790, 500)`.

The ball reflects off the obstacle faces. How the obstacles are positioned,
whether they move, and how the ball collides with them are defined in
`specs/obstacles.md`.

## Ball

- Every ball is a circle of radius 11 (diameter 22).
- Serve speed is 520 px/s. Each paddle hit multiplies a ball's speed by 1.04, up
  to a speed cap of 980 px/s. Wall and obstacle bounces do not change speed.
- How many balls are in play, where they spawn, how they are served, and what
  happens after a point are defined in `specs/balls.md`.
