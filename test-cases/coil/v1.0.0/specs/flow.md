# Coil — Scoring, states, controls, and HUD

This file defines scoring, the game's state machine, controls, audio, the HUD,
and the behaviors that make good test targets. It refers to the geometry in
`specs/playfield.md`, the simulation in `specs/mechanics.md`, and the mode in
`specs/mode.md`.

## Scoring

- Each pellet eaten awards `10 * M` points, where `M` is the current combo
  multiplier (`1`–`5`) defined in `specs/mechanics.md`. The score never
  decreases.
- The score updates **immediately** on the tick the pellet is eaten — no
  animated count-up that lags the value.
- A **high score** ("BEST") is the highest score achieved across sessions. Store
  it locally in the browser with `localStorage` (no backend, no account). It
  updates live during play the instant the current score passes it, and is shown
  on the title screen and during play. The high score is the **only** thing that
  persists between sessions; nothing else is saved.
- If the active mode adds a bonus orb, `specs/mode.md` defines that orb's point
  value.

## Game states

The game is a small state machine. Each state has a clear screen and controls.

1. **Title / main menu.** Shows the title `COIL`, the tagline `GRID SERPENT`,
   the current `BEST` score, and a vertical menu. The menu lists the playable
   mode defined in `specs/mode.md` — that spec declares the mode's menu entry —
   followed by `HOW TO PLAY`. The selected item is
   highlighted. The board furniture (walls, a coiled snake, a pellet) may show
   dimmed behind the menu.
2. **How to play.** A simple screen describing the controls and the combo
   mechanic. Returns to the menu.
3. **Playing.** The live game: the board, walls, the snake, the pellet, and the
   HUD. The snake advances every tick and the player steers it.
4. **Paused.** Reachable from play with `Esc` or `P`. Offers **Resume**,
   **Restart**, and **Quit to menu**. The board is visible but frozen behind the
   pause menu; the tick does not advance while paused.
5. **Game over.** Shown when the snake dies. Displays `GAME OVER`, the final
   score, and the `BEST` score, with **PLAY AGAIN** and **MENU**. The final
   frame may show dimmed behind the panel.
6. **Board cleared.** The win state, shown if the snake fills every interior
   cell (see `specs/playfield.md`). It is the game-over screen with a
   `BOARD CLEARED` heading instead of `GAME OVER`; it offers the same choices.

The game starts on the title screen and does not begin a round until the player
selects the mode.

## Controls

Keyboard only.

- **Menus / pause / game-over:** `Up`/`Down` (or `W`/`S`) move the selection,
  `Enter` or `Space` confirms, `Esc` goes back.
- **Steering (in play):** `Arrow` keys **or** `WASD` turn the snake (up, down,
  left, right), following the turning rules in `specs/mechanics.md`. The two key
  sets are interchangeable and behave identically.
- **In play:** `Esc` or `P` pauses.

## Audio

Audio is **required**: synthesize it with the Web Audio API (no audio files) —
a short blip when a pellet is eaten, a brighter blip when the combo multiplier
increases, and a distinct tone when the snake dies. Modes with a bonus orb may
add a chime for eating one. Use simple synthesized waveforms (square/sine), not
samples. The game must still remain fully playable with sound muted and must
never fail to run or load if audio cannot start. Provide a mute toggle, and do
not start audio until the player interacts (browsers block autoplay).

## HUD

The HUD occupies the band above the board (`y` in `[0, 120)`; see
`specs/playfield.md`). It reads, in monospace:

- **Score** at the left: the label `SCORE` above the current score in large
  digits, its left edge near `x = 200`.
- **Best** at the right: the label `BEST` above the high score in large digits,
  its right edge near `x = 1080`.
- **Combo** centered (near `x = 640`): the current multiplier as `x2` … `x5`,
  with a thin **window bar** beneath it that drains from full to empty over the
  2.4 s combo window, in the combo accent color. The combo readout and bar are
  shown only while `M` is at least `2`; at `M = 1` the combo area is empty.
- A small, dim **mode label** (e.g. `CLASSIC`) sits in the HUD so the active
  mode is always visible.

## Key behaviors

The game must exhibit these behaviors. They make good targets for automated
tests:

- The snake advances exactly one cell per tick in its current direction and is
  always grid-aligned.
- A turn applies on the next tick, only if perpendicular to the current
  direction; a reversal into the neck is ignored, and at most one turn is
  applied per tick, so a rapid double-press can never reverse the snake.
- Eating a pellet grows the snake by exactly one cell and spawns exactly one new
  pellet, never on a wall, the snake, an obstacle, or another pellet/orb.
- The snake may follow its own retreating tail on a normal tick, but moving into
  any body cell on a growth tick (when the tail does not retract) is fatal.
- The head hitting a fatal cell — a solid wall or interior obstacle where the
  mode has them (`specs/mode.md`), or the snake's own body — ends the round
  immediately, with no grace frames.
- A pellet awards `10 * M`. `M` rises by one (capped at 5) when a pellet is
  eaten while the combo window is open, and resets to 1 when the window lapses.
- The high score persists across sessions via `localStorage` and updates live
  when the current score passes it.

## Out of scope

- Network or online play, leaderboards, or any server interaction.
- Touch or gamepad input (keyboard only for this version).
- Speed ramps or difficulty curves: the tick rate is constant within a round
  (see `specs/mechanics.md`).
- Persisting anything other than the high score between sessions.
