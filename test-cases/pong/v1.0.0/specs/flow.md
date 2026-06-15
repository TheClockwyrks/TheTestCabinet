# Carom — Match flow, states, controls, and HUD

This file defines scoring, the game's state machine, controls, audio, the HUD,
and the behaviors that make good test targets. It refers to the geometry in
`specs/playfield.md`, the physics in `specs/physics.md`, and the modes in the
mode specs under `specs/modes/`.

## Scoring and match flow

- A **point** is scored when the ball fully passes a goal edge (`x < 0` or
  `x > 1280`). The point goes to the player on the opposite side.
- **Serving.** After a point, the receiver is the player who was just scored on;
  the next serve travels toward them. The very first serve of a match picks a
  side in a fixed, non-random way (for example, always toward player one) so the
  match opens consistently.
- **Winning.** First to **11 points** wins, and the winner must **lead by at
  least 2**. If the score reaches 10-10, play continues until one player is
  two points ahead.

## Game states

The game is a small state machine. Each state has a clear screen and controls.

1. **Title / main menu.** Shows the title `CAROM`, the tagline `NEON PADDLE
   DUEL`, and a vertical menu. The menu lists the playable modes defined by the
   mode specs — each mode spec declares its own entry and where it sits in the
   menu — followed by `HOW TO PLAY`. The selected item is highlighted. The
   field furniture (paddles, ball, obstacles, net) may show dimmed behind the
   menu.
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

## Controls

Keyboard only.

- **Menus / pause / match-over:** `Up`/`Down` (or `W`/`S`) move the selection,
  `Enter` or `Space` confirms, `Esc` goes back.
- **Single-player modes** (the human controls player one): move player one with
  `W`/`S` **or** `Up`/`Down`.
- **Versus:** player one uses `W`/`S`; player two uses `Up`/`Down`.
- **In match:** `Esc` or `P` pauses.

The mode specs say which side(s) the human controls in each mode; the control
bindings above apply in every mode.

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
  `980 px/s`. Modes that override the speed rule state their own multiplier and
  cap in their mode spec.
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
