# Fathom — Scoring, lives, depth, states, and audio

This file defines scoring, lives, descending through trenches, the game's state
machine, the HUD, and audio. It refers to the maze in `specs/trench.md`, the sensing
in `specs/sensing.md`, the movement and ink in `specs/movement.md`, and the predators
in `specs/predators.md`.

## Scoring

- Plankton: `10` points each.
- Bonus drifter: `200` points (see `specs/trench.md`).
- Trench cleared: a `500`-point bonus for eating every plankton in a trench.

Score accumulates across the whole game (all trenches of one run). The current score
shows in the HUD. Scores are not persisted between sessions.

## Lives and getting caught

- You start a game with 3 lives.
- Contact with any predator (`specs/predators.md`) costs a life. If lives remain, the
  trench resets for another attempt: the forager returns to its start tile, all
  predators return to the den and re-release on their schedule, any bonus drifters are
  removed, and a brief dive countdown plays before control resumes. The plankton you
  have already eaten stay eaten: losing a life does not refill the trench (how what you
  have sensed carries across a life is defined in `specs/sensing.md`).
- Losing your last life ends the game (Game over, below).

## Depth: descending through trenches

Eating every plankton in a trench clears it and descends to the next, deeper trench
(`DEPTH 1`, `DEPTH 2`, and so on):

- The fog resets to fully dark, plankton refill the maze, the forager and predators
  reset, and the bonus-drifter cadence restarts. You may reuse your maze layout for
  every depth or use a different conforming layout per depth (your choice; both satisfy
  `specs/trench.md`).
- Deeper trenches are more dangerous, scaling with depth `d` (with `d = 1` the first
  trench):
  - Predator speeds are multiplied by `1 + 0.08 * (d - 1)`, capped at `1.40` (so they
    stop getting faster after `DEPTH 6`). This scales each predator's patrol and chase
    speeds together (including the Gloamfin's faster chase).
  - The sonar pulse range `E` (`specs/sensing.md`) shrinks by 1 tile per depth,
    `E = max(5, 9 - (d - 1))` tiles, so the deep is harder to read.
  - All other rules (the predators' senses, ink, brightness) are unchanged.

## Game states

The game is a small state machine. Each state has a clear screen and controls
(controls are defined in `specs/movement.md`).

1. Title / main menu. Shows the title `FATHOM`, the tagline `HUNT IN THE DARK`, and a
   vertical menu with `DIVE` (begin a dive), followed by `HOW TO PLAY`. The selected
   item is highlighted. A dim, dark slice of trench may show behind the menu for
   atmosphere.
2. How to play. Describes the controls, the three predators and the signal each hunts,
   and the light-versus-sonar sensing. Returns to the menu.
3. In trench. The live game: the dark maze, the forager and its light, the sonar and
   ink, plankton, predators where revealed, and the HUD.
4. Dive countdown. The brief pre-start hold at the top of a trench and after losing a
   life (a short `DIVE` countdown rendered over the trench view) before control
   resumes.
5. Paused. Reachable from the trench. Offers Resume, Restart, and Quit to menu. The
   trench is visible but frozen behind the pause menu.
6. Trench cleared. A brief interstitial when a trench is cleared (for example
   `DEPTH 1 CLEARED`) before the next, deeper trench begins.
7. Game over. Shown when the last life is lost. Displays the final score and the depth
   reached, with `PLAY AGAIN` and `MENU`.

## HUD

The HUD layout (score, mode label, lives, depth, and the sonar and ink readiness
gauges) is defined in `specs/trench.md`. The HUD is always fully lit, never fogged.

## Audio

Audio is required: synthesize it with the Web Audio API (no audio files), with
distinct short cues for eating a plankton, emitting a sonar pulse, releasing ink, a
predator's own pulse or flare, getting caught, and descending. The game must still
remain fully playable with sound muted and must never fail to run or load if audio
cannot start. Provide a mute toggle, and do not start audio until the player interacts
(browsers block autoplay).

## Out of scope

- Network or online multiplayer.
- Touch or gamepad input (keyboard only for this version).
- Predators that can be eaten, or any power-up that turns them into prey.
- Persistence of scores or settings between sessions.
