# Carom — Proof of implementation

As part of the finished build, capture **proof of implementation**: a small set
of screenshots and one short clip that evidence the game runs and the called-out
features work. A viewer compares each against the reference mockup for the same
screen, so frame each capture the way the references do (the full 1280×720 field,
fitted and centered).

Write each file to **exactly** the path below, relative to the repository root.
The paths are fixed — the validator checks for a file at each one, and the review
UI shows it beside the matching reference. Capture them from the **built** game
(serve the production build, or your dev server) using the project-local
Playwright that `package.json` pins and `init` installs; do not hand-edit images.

| Path | What it must show |
| --- | --- |
| `proof/title.png` | The title menu on load, with every menu item visible. |
| `proof/gameplay.png` | A live rally mid-match: both paddles, the ball with its motion trail, the HUD scores, and both mid-field obstacles. |
| `proof/game-over.png` | The match-over screen after a finished match, with the winner and final score. |
| `proof/rally.webm` | A short (a few seconds) screen recording of an active rally, long enough to show the ball accelerating across several paddle hits and its trail tracking it. |

Notes:

- Create the `proof/` directory if it does not exist.
- A screenshot must be a PNG; the clip must be a `.webm` — the format Playwright
  records natively (`recordVideo`), so no format conversion is needed.
- These files are **outputs** committed alongside the implementation — they are
  not part of the playable build and need not be served by it.
- You can use the `window.__carom` debugging API (`specs/instrumentation.md`) to
  put the game into the exact state each capture needs — start a match, place the
  ball and paddles, serve, and step the simulation — then capture the real,
  running game from there. Only the *setup* is fast-forwarded; what the capture
  shows must be the game's real systems.
- Producing them is part of finishing the task: a missing proof is recorded
  against the run for the viewer to see.
