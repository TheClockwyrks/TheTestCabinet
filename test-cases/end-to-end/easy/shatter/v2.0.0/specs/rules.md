# Shatter — Scoring, lives, waves, states, controls, audio, and HUD

This file defines scoring, the ship's life-cycle, the wave loop, the game's state
machine, controls, audio, and the HUD. It refers to the objects in `specs/field.md`,
`specs/ship.md`, and `specs/hazards.md`, and the rules in `specs/simulation.md`.

## Scoring

Destroying a rock by shooting it scores by size: Large 20, Medium 50, Small 100, so
smaller is worth more. Destroying the saucer scores 200. A rock recycled by the star
scores nothing. The score is shown in the HUD and only ever increases within a game.

## Lives and respawn

- A game starts with 3 ships. Losing a ship costs one life; when the last ship is
  lost the game ends (see Game states, Game over).
- The player earns one extra ship each time the score crosses a multiple of 10,000
  points (at 10,000, 20,000, and so on). Show a brief indication when it is awarded.
- A ship is destroyed when it collides with a rock, the saucer, or a saucer bullet
  (`specs/simulation.md`), unless it is in the respawn invulnerability window below.
  The star's core does not destroy the ship; the ship slides along it
  (`specs/simulation.md`).
- After a death, if any lives remain, the next ship appears at rest at the safe point
  `(640, 560)` facing up, and is invulnerable for 2.5 seconds, shown by a visible
  blink. During this window the ship is fully controllable but ignores all
  collisions, so a rock or the saucer drifting over the spawn point cannot kill it
  before the player takes control; collisions resume the instant the window ends.

## Waves

The game is an endless series of waves of rocks.

- Wave `N` spawns `3 + N` Large rocks, so wave 1 has 4, wave 2 has 5, and so on.
  Spawn them at random positions at least 300 px from the ship and at least 200 px
  from the star, each drifting in a random direction at a Large rock's base drift
  speed (`specs/hazards.md`). Each successive wave scales the base drift speeds of
  newly spawned rocks up by 4% per wave, capped at +40%, so later waves drift faster.
- A wave is cleared when no rocks remain on the field, which happens only by shooting
  every rock down to nothing, since the star recycles rather than removes
  (`specs/hazards.md`). On clearing, show a brief `WAVE N` banner (about 1.5 s, with
  `N` the wave about to start) centered on the field, then spawn the next wave. The
  ship keeps flying during the banner.

## Game states

The game is a small state machine. Each state has a clear screen and controls.

1. Title / main menu. Shows the title `SHATTER`, the tagline `GRAVITY WELL SHOOTER`,
   and a vertical menu of `PLAY` then `HOW TO PLAY`. The selected item is
   highlighted. The field furniture (the star with its halo, a few dimmed drifting
   rocks, and the ship) may show dimmed behind the menu.
2. How to play. A simple screen describing the controls and the gravity, shooting,
   splitting, and wave mechanics. Returns to the menu.
3. In game. The live game: the ship, the star, the rocks, any bullets, the saucer,
   and the HUD (score and remaining lives).
4. Paused. Reachable from the game. Offers `RESUME`, `RESTART`, and `QUIT TO MENU`.
   The field is visible but frozen behind the pause menu.
5. Game over. Shown when the last life is lost. Displays `GAME OVER`, the final
   score, and the wave reached, with `PLAY AGAIN` and `MENU`.

## Controls

Keyboard only.

- Menus, pause, and game-over: `Up`/`Down` (or `W`/`S`) move the selection, `Enter`
  or `Space` confirms, `Esc` goes back.
- Flying: rotate with `Left`/`Right` or `A`/`D`; thrust with `Up` or `W`; fire with
  `Space`.
- In game: `Esc` or `P` pauses.

## Audio

Audio is required: synthesize it with the Web Audio API (no audio files). Provide
distinct short sounds for firing, a rock shattering, the ship's thrust, the saucer's
presence, and the ship being destroyed. The game stays fully playable with sound
muted and never fails to run or load if audio cannot start. Provide a mute toggle
(`M`), and do not start audio until the player first interacts, since browsers block
autoplay.

## HUD

- The score sits at the top-left in large monospace digits (about 44 px tall), its
  left edge near `x = 40` and its top near `y = 28`.
- Remaining lives are shown just below the score as a row of small ship glyphs, one
  per life still in reserve, starting near `(44, 92)`.
- A `WAVE N` banner appears centered on the field at the start of each wave (see
  Waves) and is not part of the persistent HUD.

## Out of scope

- Network or online multiplayer, and any second local player (single ship only).
- Touch or gamepad input (keyboard only).
- A hyperspace or teleport escape move.
- Persistence of scores or settings between sessions (no high-score table).
