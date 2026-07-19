# Spectra — Game states, the HUD, and audio

This file defines the game's state machine, the HUD, audio, and what is out of
scope. It refers to the controls in `specs/controls.md`, the stage in
`specs/playfield.md`, the stages and scoring in `specs/stages.md`, the drones in
`specs/drones.md`, and the mode in `specs/mode.md`.

## Game states

The game is a small state machine. Each state has a clear screen and controls
(controls are defined in `specs/controls.md`).

1. Title / main menu. Shows the title `SPECTRA`, the tagline `TUNE TO SURVIVE`, and
   a vertical menu listing the playable mode defined in `specs/mode.md` (which
   declares the mode's menu entry), followed by `HOW TO PLAY`. The selected item is
   highlighted. A dim slice of starfield with a drone or two may show behind the
   menu for atmosphere.
2. How to play. Describes the controls, the two bands and the match-to-destroy and
   shield rules, the three drones, and the discharge. Returns to the menu.
3. Stage intro. A brief hold before a wave, showing `STAGE n` (or
   `CHALLENGING STAGE`) over the field before the drones begin to enter.
4. In wave. The live game: the formation, the drones entering, diving, and firing,
   your ship and its bullets, and the HUD. Includes the brief `READY` hold after
   losing a life.
5. Paused. Reachable from a wave. Offers Resume, Restart, and Quit to menu. The
   field is visible but frozen behind the pause menu.
6. Stage cleared. A brief interstitial when a stage is cleared (e.g.
   `STAGE 1 CLEARED`, with the stage bonus, or a challenge-stage result) before the
   next stage begins.
7. Game over. Shown when the last life is lost. Displays the final score and the
   stage reached, with `PLAY AGAIN` and `MENU`.

## HUD

The HUD layout (score and stage in the top strip; lives, the resonance meter, and
the polarity indicator in the bottom strip) is defined in `specs/playfield.md`. The
polarity indicator and the ship's core color always show the current band.

## Audio

Audio is required: synthesize it with the Web Audio API (no audio files), with
distinct short cues for firing, flipping bands, absorbing a same-band bullet, a
matching kill, a discharge, a Prism's spectral inversion, getting hit, and
clearing a stage. The game stays fully playable with sound muted and never fails
to run or load if audio cannot start. Provide a mute toggle, and do not start
audio until the player interacts (browsers block autoplay).

## Out of scope

- Network or online multiplayer.
- Touch or gamepad input (keyboard only for this version).
- Capturable or turnable drones, a captured-ship rescue, or a second/escort ship
  power-up.
- Persistence of scores or settings between sessions.
