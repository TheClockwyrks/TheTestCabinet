# Carom — Playfield, paddles, obstacles, and ball

This file defines the geometry of the field and the objects in it. All positions
and sizes are in the logical-pixel coordinate system defined in
`specs/overview.md` (a fixed `1280 x 720` play area, origin top-left).

## Playfield

- The field spans the full `1280 x 720` area.
- The **top wall** (`y = 0`) and **bottom wall** (`y = 720`) are solid; the ball
  reflects off them.
- The **left and right edges** are goals. The ball passing `x < 0` scores for
  player two (right); passing `x > 1280` scores for player one (left).
- A dashed center net is drawn at `x = 640` for decoration; it has no collision.

## Paddles

- Each paddle is a rounded bar **16 wide x 110 tall**.
- The **left (player one)** paddle occupies `x` in `[48, 64]`. The **right
  (player two / AI)** paddle occupies `x` in `[1216, 1232]`.
- A paddle moves only vertically. Its center `y` is clamped so the paddle stays
  fully on the field: center `y` in `[55, 665]`.
- A paddle moves at a constant **720 logical px/s** while a movement key is held,
  and is stationary otherwise. Its current vertical velocity (`-720`, `0`, or
  `+720`) is used by the spin mechanic, so track it explicitly.

## Obstacles

Two **fixed, static** obstacles sit in the field. Each is a rounded bar **20
wide x 140 tall**. They are placed mirror-symmetrically through the field
center `(640, 360)`, so neither side is favored:

- **Obstacle A:** `x` in `[480, 500]`, `y` in `[150, 290]` (center `490, 220`).
- **Obstacle B:** `x` in `[780, 800]`, `y` in `[430, 570]` (center `790, 500`).

The ball reflects off obstacle faces like a wall (see Collision in
`specs/physics.md`). Obstacles do not move in this version.

## Ball

- The ball is a circle of **radius 11** (diameter 22).
- **Serve speed** is **520 px/s**. Each paddle hit multiplies speed by **1.04**
  (modes may override this; see the mode specs under `specs/modes/`), up to a
  **speed cap of 980 px/s**. Wall and obstacle bounces do not change speed.
- At the start of the match and after each point, the ball spawns at the center
  `(640, 360)`, holds for a **1.0 s** countdown, then serves toward the player
  who is about to receive (see Scoring and match flow in `specs/flow.md`). The
  serve direction is within **+/-30deg** of horizontal, with a small fixed
  vertical component so the first volley is never perfectly flat.
