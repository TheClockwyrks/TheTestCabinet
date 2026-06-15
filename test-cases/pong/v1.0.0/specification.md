# Carom — Specification

> This document is the specification handed to the model. It is the primary
> material for the build. Implement the game it describes.

## Overview

**Carom** is a neon, top-down paddle duel for the browser. Two paddles face each
other across a dark field; a ball ricochets between them, off the top and bottom
walls, and off a pair of fixed obstacles in the middle of the field. A player
scores when the ball passes the far edge behind their opponent's paddle.

Carom is a duel of angles. Its defining mechanic is **spin**: the motion of a
paddle at the moment it strikes the ball curves the ball's flight afterward, so
skilled play is about shaping the ball's path, not just blocking it. The fixed
obstacles turn the field into a bank-shot puzzle.

Carom is inspired by classic paddle-and-ball arcade games but is its own game,
with an original name, look, spin mechanic, and obstacle layout. Do not
reproduce the assets, branding, or exact design of any existing game.

## Goal of this build

Produce a complete, polished, **playable** game that runs entirely in a browser.
This is a substantial front-end task: real-time rendered graphics, a physics
loop, multiple game states and menus, an AI opponent, and a local two-player
mode. Aim for a build a person would actually enjoy playing, not a tech demo.

### Hard requirements

- **Renders real graphics.** Draw the game with Canvas 2D, WebGL/WebGPU, or
  positioned DOM elements. A text-only or ASCII rendering does not satisfy this
  test case.
- **Runs in the browser with no backend.** No server, accounts, database, or
  network calls at runtime. Everything needed to play must be self-contained.
- **No API keys or credentials** of any kind to build, run, or play.
- **Static production build.** The project must build to static files that can
  be served by any static file server, and must run from that build.
- **Documentation.** Include a `README.md` in the produced repository explaining
  what the game is, how to install dependencies, how to run it in development,
  how to produce the static production build, and the controls.

### Free choices

You choose the language, framework, build tool, and rendering approach, subject
to the requirements above. Plain TypeScript with Canvas 2D is entirely
sufficient; a framework is not required. Favor a clean, well-structured codebase
over any particular technology.

## Coordinate system and presentation

All positions, sizes, and speeds in this document are given in **logical
pixels** on a fixed **1280 &times; 720** play area (16:9). The origin `(0, 0)` is
the **top-left**; `x` increases to the right and `y` increases downward.

- The play area scales uniformly to fit the browser window while preserving its
  16:9 aspect ratio, letterboxed with the background color on the remaining
  space. The game must remain correct and centered at any window size.
- Gameplay logic operates in logical-pixel space, independent of the rendered
  scale.

## Visual design

The look is neon-on-charcoal. The canonical palette and type are defined below;
match them.

| Element                | Color     |
| ---------------------- | --------- |
| Field background       | `#0b0e14` |
| Player one paddle      | `#3ae7c4` |
| Player two / AI paddle | `#ff5c8a` |
| Ball                   | `#f2f5f7` |
| Obstacles              | `#ffb454` |
| Center net             | `#243044` |
| Primary text           | `#e6edf3` |
| Secondary text         | `#8a94a6` |

- Use a **monospace** type family for all text (scores, menus, labels). Do not
  depend on a web font that must be downloaded; a system monospace stack is
  required so the game renders identically offline.
- Paddles, the ball, and obstacles have a soft neon glow. The center net is a
  dashed vertical line at `x = 640`.
- The three canonical screens — the title screen, the in-match view, and the
  match-over screen — are described in full under Game States below. Implement
  each as described, in this palette and type.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look:

- `reference/title.png` — the title screen and main menu.
- `reference/gameplay.png` — a representative in-match frame.
- `reference/game-over.png` — the match-over screen.

Treat them as visual targets: match their layout, palette, and type. They are
images only — build the screens from this specification.

## Playfield

- The field spans the full `1280 &times; 720` area.
- The **top wall** (`y = 0`) and **bottom wall** (`y = 720`) are solid; the ball
  reflects off them.
- The **left and right edges** are goals. The ball passing `x < 0` scores for
  player two (right); passing `x > 1280` scores for player one (left).
- A dashed center net is drawn at `x = 640` for decoration; it has no collision.

### Paddles

- Each paddle is a rounded bar **16 wide &times; 110 tall**.
- The **left (player one)** paddle occupies `x` in `[48, 64]`. The **right
  (player two / AI)** paddle occupies `x` in `[1216, 1232]`.
- A paddle moves only vertically. Its center `y` is clamped so the paddle stays
  fully on the field: center `y` in `[55, 665]`.
- A paddle moves at a constant **720 logical px/s** while a movement key is held,
  and is stationary otherwise. Its current vertical velocity (`-720`, `0`, or
  `+720`) is used by the spin mechanic, so track it explicitly.

### Obstacles

Two **fixed, static** obstacles sit in the field. Each is a rounded bar **20
wide &times; 140 tall**. They are placed mirror-symmetrically through the field
center `(640, 360)`, so neither side is favored:

- **Obstacle A:** `x` in `[480, 500]`, `y` in `[150, 290]` (center `490, 220`).
- **Obstacle B:** `x` in `[780, 800]`, `y` in `[430, 570]` (center `790, 500`).

The ball reflects off obstacle faces like a wall (see Collision). Obstacles do
not move in this version.

### Ball

- The ball is a circle of **radius 11** (diameter 22).
- **Serve speed** is **520 px/s**. Each paddle hit multiplies speed by **1.04**
  (see Frenzy for the exception), up to a **speed cap of 980 px/s**. Wall and
  obstacle bounces do not change speed.
- At the start of the match and after each point, the ball spawns at the center
  `(640, 360)`, holds for a **1.0 s** countdown, then serves toward the player
  who is about to receive (see Serving). The serve direction is within
  **&plusmn;30&deg;** of horizontal, with a small fixed vertical component so the
  first volley is never perfectly flat.

## Physics

Run the simulation on a **fixed timestep** (for example 120 Hz) decoupled from
rendering, integrating positions each step. A fixed timestep keeps behavior
reproducible and testable; do not tie physics to the rendering frame rate.

Each step, for the ball:

1. Apply the spin acceleration (below) to the velocity.
2. Advance position by `velocity * dt`.
3. Resolve collisions with walls, paddles, and obstacles.

### Collision

Resolve the ball against the top/bottom walls, the two paddles, and the two
obstacles. Treat the ball as a circle and each paddle/obstacle as an
axis-aligned rectangle.

- **Top / bottom wall:** reflect the vertical velocity (`vy &rarr; -vy`) and push
  the ball back inside the field. Speed is unchanged.
- **Obstacle:** reflect the velocity component normal to the face that was hit
  (a side hit flips `vx`; a top/bottom hit flips `vy`), and push the ball out of
  the obstacle. Speed is unchanged; **spin is preserved** and keeps curving the
  ball after the bounce.
- **Paddle:** see the next section. A paddle hit is the only collision that
  changes speed and that imparts spin.

The ball must never tunnel through a paddle, wall, or obstacle at high speed; use
swept collision or a small enough timestep to prevent it.

### Paddle bounce and spin (signature mechanic)

When the ball strikes a paddle:

1. **Reflection angle from contact point.** Let
   `offset = (ballCenterY - paddleCenterY) / 55`, clamped to `[-1, 1]` (55 is the
   paddle half-height). The outgoing angle from horizontal is
   `theta = offset * 55deg`. Hitting the paddle center sends the ball straight
   across; hitting the top or bottom edge sends it off at up to 55&deg;.

2. **Speed.** `speed = min(speed * 1.04, 980)` (normal/versus). The horizontal
   direction flips to point toward the opposing goal.
   New velocity: `vx = +/- speed * cos(theta)` (sign toward the opponent),
   `vy = speed * sin(theta)`.

3. **Spin from paddle motion.** The paddle's vertical velocity at contact adds
   spin: `spin += paddleVy * 0.85`, then clamp `spin` to `[-900, 900]`. A paddle
   moving downward as it strikes curves the ball one way; moving upward curves it
   the other; a still paddle imparts no new spin.

**How spin curves the ball.** Spin is a signed scalar carried by the ball. Each
physics step it applies a lateral acceleration **perpendicular to the ball's
direction of travel**, of magnitude `|spin|` (in px/s&sup2;), curving the path
toward the side determined by the sign of `spin`. Spin **decays** toward zero
exponentially with a time constant such that it loses about **half its
magnitude every 0.8 s** (`spin *= 0.5 ^ (dt / 0.8)` per step). Spin persists
across wall and obstacle bounces and is only changed by paddle hits and decay.

The result: a paddle swiped at the moment of contact bends the ball's flight,
letting a player curve shots around the obstacles or wrong-foot the opponent.

## Scoring and match flow

- A **point** is scored when the ball fully passes a goal edge (`x < 0` or
  `x > 1280`). The point goes to the player on the opposite side.
- **Serving.** After a point, the receiver is the player who was just scored on;
  the next serve travels toward them. The very first serve of a match picks a
  side in a fixed, non-random way (for example, always toward player one) so the
  match opens consistently.
- **Winning.** First to **11 points** wins, and the winner must **lead by at
  least 2**. If the score reaches 10&ndash;10, play continues until one player is
  two points ahead.

## Game states

The game is a small state machine. Each state has a clear screen and controls.

1. **Title / main menu.** Shows the title `CAROM`, the tagline `NEON PADDLE
   DUEL`, and a vertical menu: **SOLO**, **VERSUS**, **FRENZY**, **HOW TO PLAY**.
   The selected item is highlighted. The field furniture (paddles, ball,
   obstacles, net) may show dimmed behind the menu.
2. **How to play.** A simple screen describing the controls and the spin and
   obstacle mechanics. Returns to the menu.
3. **In match.** The live game: paddles, ball, obstacles, net, the two scores
   near the top, and a small mode label.
4. **Countdown.** The brief pre-serve hold shown at match start and after each
   point (rendered over the in-match field).
5. **Paused.** Reachable from the match. Offers **Resume**, **Restart**, and
   **Quit to menu**. The field is visible but frozen behind the pause menu.
6. **Match over.** Shown when a player wins. Displays the winner and the final
   score, with **PLAY AGAIN** and **MENU**.

## Modes

- **Solo** — player one (left, controlled by the human) versus the AI (right).
- **Versus** — two local players share the keyboard.
- **Frenzy** — same as Solo (human versus AI), but the speed ramp is steeper and
  uncapped: each paddle hit multiplies ball speed by **1.08** with **no speed
  cap**. Frenzy is the fast, escalating variant; the rally ends quickly.

## AI opponent

The AI controls the right paddle in Solo and Frenzy. It should be a competent but
**beatable** opponent, not a perfect wall.

- The AI may only move its paddle vertically, at a maximum of **560 px/s** —
  deliberately slower than the human's 720 px/s, so a well-placed or well-curved
  shot can beat it.
- When the ball is moving **toward** the AI, it tracks the ball's `y`, moving
  toward it but reacting with a short delay (about **0.12 s**) and stopping when
  the paddle center is within a small **10 px** deadzone of the target. It need
  not perfectly account for spin curvature — failing to read a curving shot is a
  fair way for the player to score.
- When the ball is moving **away**, the AI eases back toward the vertical center
  (`y = 360`).

These values are guidance for the right feel; tune as needed, but keep the AI
clearly beatable by a skilled player and clearly capable of punishing weak play.

## Controls

Keyboard only.

- **Menus / pause / match-over:** `Up`/`Down` (or `W`/`S`) move the selection,
  `Enter` or `Space` confirms, `Esc` goes back.
- **Solo / Frenzy:** the human moves player one with `W`/`S` **or** `Up`/`Down`.
- **Versus:** player one uses `W`/`S`; player two uses `Up`/`Down`.
- **In match:** `Esc` or `P` pauses.

## Audio

Audio is recommended but optional, and must never be required for the game to run
or load. If included, synthesize it with the Web Audio API (no audio files):
distinct short blips for a paddle hit, a wall/obstacle bounce, and a scored
point. Provide a mute toggle, and do not start audio until the player interacts
(browsers block autoplay).

## HUD

- The two scores sit near the top of the field in large monospace digits (about
  76 px tall): player one's score centered near `x = 520` and player two's near
  `x = 760`, with their tops near `y = 40`.
- A small, dim mode label (e.g. `SOLO`) sits in the top-left during a match.

## Key behaviors

The game must exhibit these behaviors. They make good targets for automated
tests:

- A ball striking the **center** of a **stationary** paddle leaves at angle
  `0` — purely horizontal, toward the opposing goal.
- A ball striking the extreme **top/bottom edge** of a paddle leaves at
  `+/- 55deg` from horizontal.
- A normal/versus paddle hit multiplies ball speed by `1.04`, clamped at
  `980 px/s`; a Frenzy hit multiplies by `1.08` with no cap.
- The sign of imparted spin follows the paddle's direction of motion at contact;
  a stationary paddle imparts no new spin.
- Spin curves the ball laterally and decays to roughly half magnitude every
  `0.8 s`, reaching near zero within a couple of seconds if not refreshed.
- Top/bottom wall and obstacle bounces preserve speed; obstacle bounces preserve
  spin.
- A ball crossing a goal edge increments the correct player's score, and the
  next serve travels toward the player who was scored on.
- A match ends only when a player reaches at least 11 points **and** leads by at
  least 2.

## Out of scope

- Network or online multiplayer.
- Touch or gamepad input (keyboard only for this version).
- Moving or destructible obstacles (the layout is fixed in this version).
- Persistence of scores or settings between sessions.
