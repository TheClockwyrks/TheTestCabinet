# Proof of implementation

As part of the finished build, capture proof of implementation: a small set of
screenshots and two short clips that evidence the game runs and the called-out
features work. Each is compared against the reference mockup for the same screen, so
frame each capture the way the references do, showing the full 1280 x 720 stage
fitted and centered.

Write each file to exactly the path below, relative to the repository root. The paths
are fixed, so a viewer can find each capture and place it beside the matching
reference. Capture them from the built game (serve the production build, or your dev
server) using the project-local Playwright that `package.json` pins and `init`
installs; do not hand-edit the media.

| Path | What it must show |
| --- | --- |
| `proof/title.png` | The title menu on load, with every menu item visible (`PLAY`, `HOW TO PLAY`). |
| `proof/mode-select.png` | The mode-select menu (reached via `PLAY`), showing the mode entries with one mode focused and its description visible (`specs/modes.md`, `specs/states.md`). |
| `proof/gameplay.png` | A live mid-wave frame: a maze of towers the player built, towers at a range of heats (at least one cold/blue, one white-hot near the redline, and one tripped red), a Forge and a Sink beside emitters, the surge walking the maze plus at least one flyer, surge health bars, and the build panel (money, lives, `WAVE n / N`, the shop, and a selected tower's heat read). |
| `proof/game-over.png` | An end screen after a finished game, Game over (reactor breached) or Victory, with the final score and wave reached. |
| `proof/heat.webm` | A short clip of heat as power: an emitter heating up through the ramp (cold to white-hot) as the surge pours through it, its damage visibly climbing, then tripping the redline and going offline for a few seconds (a hole in the defense), then coming back online, ideally also showing a Sink beside a hot emitter holding it under the redline, or a Forge warming a cold one. |
| `proof/siege.webm` | A short clip of the defense: the surge pathing the maze the player built, the maze re-pathing when a tower is placed or sold, a flyer crossing straight over the maze and being shot down (or leaking), ideally with Flak showing its air-only role, and a unit leaking an exhaust and costing a life. |

Notes:

- Create the `proof/` directory if it does not exist.
- A screenshot must be a PNG; each clip must be a `.webm` of a few seconds, the format
  Playwright records natively with `recordVideo`, so no format conversion is needed.
- These files are outputs committed alongside the implementation. They are not part of
  the playable build and need not be served by it.
- You can use the `window.__meltdown` debugging API (`specs/instrumentation.md`) to put
  the game into the exact state each capture needs: start a game, place towers, set
  heat or money, spawn surge, start a wave, and step the simulation, then capture the
  real, running game from there. Only the setup is fast-forwarded; what the capture
  shows is the game's real systems.
- Producing them is part of finishing the task.
