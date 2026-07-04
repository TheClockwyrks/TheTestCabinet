# Proof

As part of the finished build, capture **proof of implementation**: a small set
of screenshots and one short clip that demonstrate the game runs and the
called-out features work. A reviewer compares each against the reference mockup
for the same screen, so frame each capture the way the references do (the full
`1280 x 720` table, fitted and centered).

Write each file to **exactly** the path below, relative to the repository root.
The paths are fixed — the validator checks for a file at each one, and the review
UI shows it beside the matching reference. Capture them from the **built** game
(serve the production build, or your dev server) using the project-local
Playwright that `package.json` pins and `init` installs; do not hand-edit images.

| Path | What it must show |
| --- | --- |
| `proof/title.png` | The title screen and main menu on load, with the title, the menu items, and the deal-mode label visible. |
| `proof/gameplay.png` | A live table mid-game: the stock, the waste (turned per the deal mode), cards on at least one foundation, and the seven tableau columns with face-down and face-up cards. |
| `proof/win.png` | The won game with the **victory cascade** on screen — the table painted with bouncing-card trails (ideally with the `YOU WIN` message shown). |
| `proof/cascade.mp4` | A short (a few seconds) screen recording of the victory cascade playing: foundation cards launching one after another, bouncing off the bottom edge, and painting their trails across the table until the screen fills. |

Notes:

- Create the `proof/` directory if it does not exist.
- A screenshot must be a PNG; the clip must be an `.mp4`.
- These files are **outputs** committed alongside the implementation — they are
  not part of the playable build and need not be served by it.
- Producing them is part of finishing the task: a missing proof is recorded
  against the run for the reviewer to see. The `cascade.mp4` in particular is the
  evidence for the signature animation — do not skip it.
- To reach a winnable state quickly for the win captures, you may drive the built
  game with Playwright rather than playing by hand; capture from the real built
  game, not a mock-up.
