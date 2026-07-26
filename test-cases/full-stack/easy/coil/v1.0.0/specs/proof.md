# Coil — Proof of implementation

As part of the finished build, capture proof of implementation: a small set of
screenshots and one short clip that evidence the game runs and the called-out
features work. Each capture is paired with the reference mockup for the same
screen, so frame each capture the way the references do (the full 1280x720 stage,
fitted and centered).

Write each file to exactly the path below, relative to the repository root. The
paths are fixed. Capture them from the built game (serve the production build, or
your dev server) using the project-local Playwright that `package.json` pins and
`init` installs; do not hand-edit images.

| Path | What it must show |
| --- | --- |
| `proof/title.png` | The title menu on load, with every menu item and the BEST score visible. |
| `proof/gameplay.png` | A live round mid-play: the gridded board, the snake (head distinct from body), the current pellet, and the HUD. |
| `proof/game-over.png` | The game-over screen after a finished round, with the final score and BEST. |
| `proof/combo.webm` | A short (a few seconds) screen recording of an active round where the combo multiplier rises past x2 and its window bar visibly drains in the HUD. |

Notes:

- Create the `proof/` directory if it does not exist.
- A screenshot must be a PNG; the clip must be a `.webm`, the format Playwright
  records natively (`recordVideo`), so no format conversion is needed.
- These files are outputs committed alongside the implementation. They are not part
  of the playable build and need not be served by it.
- Producing them is part of finishing the task.
