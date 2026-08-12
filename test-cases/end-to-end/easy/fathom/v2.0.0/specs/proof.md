# Fathom — Proof of implementation

As part of the finished build, capture proof of implementation: a small set of
screenshots and two short clips that evidence the game runs and the called-out
features work. Each is compared against the reference mockup for the same screen, so
frame each capture the way the references do, showing the full 1280 x 720 stage,
fitted and centered.

Write each file to exactly the path below, relative to the repository root. The paths
are fixed. Capture them from the built game (serve the production build, or your dev
server) using the project-local Playwright that `package.json` pins and `init`
installs; do not hand-edit the media.

| Path | What it must show |
| --- | --- |
| `proof/title.png` | The title menu on load, with every menu item visible. |
| `proof/gameplay.png` | A live in-maze frame mid-dark: the forager with its lit pocket of revealed maze fading into black fog, plankton, the HUD, and at least one predator visible where light or sonar reaches. |
| `proof/game-over.png` | The game-over screen after a finished game, with the final score and depth reached. |
| `proof/sonar.webm` | A short clip of a sonar pulse: the wavefront traveling outward through the corridors around a corner (revealing near tiles before far ones, not as an expanding circle) and marking a predator beyond the bend for its brief window as the front reaches it (reaching a predator your ordinary light does not). |
| `proof/hunt.webm` | A short clip of a predator hunting: a predator appearing out of the dark and chasing the forager, then being shaken. For example the Gloamfin sprinting to where its ping heard you and casting about when you have slipped away, or the Lanternjaw pulled in as you brighten and lost as you go dim or ink. |

Notes:

- Create the `proof/` directory if it does not exist.
- A screenshot must be a PNG; each clip must be a `.webm` of a few seconds, the format
  Playwright records natively (`recordVideo`), so no format conversion is needed.
- These files are outputs committed alongside the implementation. They are not part of
  the playable build and need not be served by it.
- You can use the `window.__fathom` debugging API (`specs/instrumentation.md`) to put
  the game into the exact state each capture needs: start a dive, place the forager and
  predators, brighten, ping, and step the simulation, then capture the real, running
  game from there. Only the setup is fast-forwarded; what the capture shows is the
  game's real systems.
- Producing them is part of finishing the task.
