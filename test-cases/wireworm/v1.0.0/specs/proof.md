# Proof of Implementation

As part of the finished build, capture **proof of implementation**: a small set
of screenshots and two short clips that evidence the game runs and the called-out
features work. A reviewer compares each against the reference mockup for the same
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
| `proof/gameplay.png` | A live mid-level frame: the board with a node field at a **range of charges** (at least one inert, one mid-charge, and one **critical** node pulsing), the data-worm winding down (ideally showing a **split** into two worms), the cursor in its band having just fired, at least one **foe** (a glitch, dropper, or corruptor), and the HUD bar (score, lives, `LEVEL n / 12`). |
| `proof/game-over.png` | An end screen after a finished game — Game over or Victory — with the final score and level reached. |
| `proof/discharge.webm` | A short clip of the **signature discharge**: the worm charging a cluster of nodes up to **critical**, then a bolt into a critical node setting off the **chain-arc** — arcs leaping through the charged cluster, the cluster clearing, and worm segments caught in the arc **frying cleanly** (leaving no nodes). Ideally show a wide chain from a dense cluster. |
| `proof/worm.webm` | A short clip of the **worm fight**: the worm winding the field and dropping/reversing on the nodes, a bolt into a **middle segment splitting** it into two worms, shot-killed segments **leaving fresh nodes** (the field thickening), and — ideally — a worm **diving** straight down a critical node, plus a foe on screen. |

Notes:

- Create the `proof/` directory if it does not exist.
- A screenshot must be a PNG; each clip must be a `.webm` of a few seconds — the
  format Playwright records natively (`recordVideo`), so no format conversion is
  needed.
- These files are **outputs** committed alongside the implementation — they are
  not part of the playable build and need not be served by it.
- Producing them is part of finishing the task: a missing proof is recorded
  against the run for the reviewer to see.
