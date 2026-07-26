# Fathom — Scoring, lives, depth, and audio

This file defines scoring, lives, descending through mazes, depth scaling, and audio.
It refers to the maze in `specs/maze.md`, the gameplay systems (sensing, sonar, ink,
plankton, and drifters) in `specs/gameplay.md`, the movement in `specs/movement.md`,
and the predators in `specs/predators.md`. The menus, game states, and HUD that show
these values are in `specs/ui.md`.

## Scoring

- Plankton: `10` points each.
- Bonus drifter: `200` points (see `specs/gameplay.md`).
- Maze cleared: a `500`-point bonus for eating every plankton in a maze.

Score accumulates across the whole game (all mazes of one run). The current score
shows in the HUD. Scores are not persisted between sessions.

## Lives and getting caught

- You start a game with 3 lives.
- Contact with any predator (`specs/predators.md`) costs a life. If lives remain, the
  maze resets for another attempt: the forager returns to its start tile, all
  predators return to the den and re-release on their schedule, any bonus drifters are
  removed, and a brief dive countdown plays before control resumes. The plankton you
  have already eaten stay eaten: losing a life does not refill the maze (how what you
  have sensed carries across a life is defined in `specs/gameplay.md`).
- Losing your last life ends the game (Game over; see `specs/ui.md`).

## Depth: descending through mazes

Eating every plankton in a maze clears it and descends to the next, deeper maze
(`DEPTH 1`, `DEPTH 2`, and so on):

- The fog resets to fully dark, plankton refill the maze, the forager and predators
  reset, and the bonus-drifter cadence restarts. You may reuse your maze layout for
  every depth or use a different conforming layout per depth (your choice; both satisfy
  `specs/maze.md`).
- Deeper mazes are more dangerous, scaling with depth `d` (with `d = 1` the first
  maze):
  - More predators, not faster ones. Each deeper maze holds one more predator than the
    last, up to a cap of two of each kind (six predators total) reached at `DEPTH 4`.
    The exact roster, the order hunters are added, and the release schedule are defined
    in `specs/predators.md`. Predator speeds do not change with depth.
  - The sonar pulse range `E` (`specs/gameplay.md`) shrinks by 1 tile per depth,
    `E = max(5, 9 - (d - 1))` tiles, so the deep is harder to read.
  - All other rules (the predators' senses, ink, brightness) are unchanged.

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
