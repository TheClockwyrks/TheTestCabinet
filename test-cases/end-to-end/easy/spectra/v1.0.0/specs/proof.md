# Spectra — Proof of implementation

As part of the finished build, capture **proof of implementation**: a small set
of screenshots and two short clips that evidence the game runs and the called-out
features work. A viewer compares each against the reference mockup for the same
screen, so frame each capture the way the references do (the full `1280 x 720`
stage, fitted and centered).

Write each file to **exactly** the path below, relative to the repository root.
The paths are fixed — the validator checks for a file at each one, and the review
UI shows it beside the matching reference. Capture them from the **built** game
(serve the production build, or your dev server) using the project-local
Playwright that `package.json` pins and `init` installs; do not hand-edit the
media.

| Path | What it must show |
| --- | --- |
| `proof/title.png` | The title menu on load, with every menu item visible. |
| `proof/gameplay.png` | A live in-wave frame: the swaying formation holding both bands (including a Prism), at least one drone diving with enemy bullets on the field, the player ship in a clearly readable band with a shot in flight, and the HUD (score, stage, lives, the resonance meter, and the polarity indicator). |
| `proof/game-over.png` | The game-over screen after a finished game, with the final score and the stage reached. |
| `proof/polarity.webm` | A short clip of the **dual-use polarity**: flipping bands to match-and-destroy a drone of one band, an enemy bullet of your current band being **absorbed** harmlessly, and a **mismatched** shot passing through a drone of the other band with no effect (wasted). |
| `proof/assault.webm` | A short clip of the **swarm choreography**: drones flying in along their entrance paths and assembling into the formation, then a **dive attack** — ideally including a Prism broken shell-then-core, or a Prism reaching the bottom and triggering the spectral inversion. |

Notes:

- Create the `proof/` directory if it does not exist.
- A screenshot must be a PNG; each clip must be a `.webm` of a few seconds — the
  format Playwright records natively (`recordVideo`), so no format conversion is
  needed.
- These files are **outputs** committed alongside the implementation — they are
  not part of the playable build and need not be served by it.
- Producing them is part of finishing the task: a missing proof is recorded
  against the run for the viewer to see.
