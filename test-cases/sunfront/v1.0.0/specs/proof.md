# Sunfront — Proof of implementation

As part of the finished build, capture **proof of implementation**: a small set
of screenshots and one short clip that evidence the game runs and the called-out
features work. A reviewer compares each against the reference mockup for the same
screen, so frame each capture the way the references do (the full fitted 16:9 view,
centered, with the diagonal arena in frame).

Write each file to **exactly** the path below, relative to the repository root.
The paths are fixed — the validator checks for a file at each one, and the review
UI shows it beside the matching reference. Capture them from the **built** game
(serve the production build, or your dev server) using the project-local
Playwright that `package.json` pins and `init` installs; do not hand-edit images.

| Path | What it must show |
| --- | --- |
| `proof/title.png` | The title screen and main menu on load, with every menu item visible. |
| `proof/gameplay.png` | A live mid-match frame: both armies (rendered from the provided models) fighting along the diagonal, the player's staging yard with several **placed build-grid structures** (spawners and/or Solar Extractors), the HUD (sol, income, wave timer, both base health bars), and the **fog** blacking out the enemy staging yard. |
| `proof/game-over.png` | The match-over screen after a finished match, showing `VICTORY` or `DEFEAT` and the wave count. |
| `proof/wave.mp4` | A short (a few seconds) screen recording spanning a **wave firing**: fresh units mustering at your base and marching down the diagonal, engaging the enemy line, and the front line shifting — enough to show the provided models move (locomotion clips), fight, and die. |

Notes:

- Create the `proof/` directory if it does not exist.
- A screenshot must be a PNG; the clip must be an `.mp4`.
- These files are **outputs** committed alongside the implementation — they are
  not part of the playable build and need not be served by it.
- Producing them is part of finishing the task: a missing proof is recorded
  against the run for the reviewer to see.
