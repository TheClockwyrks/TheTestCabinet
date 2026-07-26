# Shatter — Proof of implementation

As part of the finished build, capture proof of implementation: a small set of
screenshots and one short clip that evidence the game runs and the called-out features
work. Each is compared against the reference mockup for the same screen, so frame each
capture the way the references do, showing the full 1280 x 720 field fitted and
centered.

Write each file to exactly the path below, relative to the repository root. The paths
are fixed. Capture them from the built game (serve the production build, or your dev
server) using the project-local Playwright that `package.json` pins and `init`
installs, and do not hand-edit images.

| Path | What it must show |
| --- | --- |
| `proof/title.png` | The title screen on load, with the title, tagline, and every menu item visible. |
| `proof/gameplay.png` | A live in-game frame: the ship, the star with its halo, several rocks mid-field, at least one bullet with its motion trail, and the HUD (score and remaining lives). |
| `proof/game-over.png` | The game-over screen after a finished game, with `GAME OVER`, the final score, and the wave reached. |
| `proof/gravity.webm` | A short (a few seconds) screen recording that shows the gravity well at work: a bullet's curving trail visibly bending as it passes near the star, and rocks curving on their paths past it. |

Notes:

- Create the `proof/` directory if it does not exist.
- A screenshot must be a PNG, and the clip must be a `.webm`, the format Playwright
  records natively with `recordVideo`.
- These files are outputs committed alongside the implementation. They are not part of
  the playable build and need not be served by it.
- You can use the `window.__shatter` debugging API (`specs/instrumentation.md`) to put
  the game into the exact state each capture needs: start a game, place the ship, the
  rocks, and a bullet, and step the simulation, then capture the real, running game
  from there. Only the setup is fast-forwarded; what the capture shows is the game's
  real systems.
- Producing them is part of finishing the task.
