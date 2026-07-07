# Proof of Implementation

As part of the finished build, capture **proof of implementation**: a small set
of
screenshots and two short clips that evidence the game runs and the called-out
features work. A reviewer compares each against the reference mockup for the same
screen, so frame each capture the way the references do (the full `1280 x 720`
stage, fitted and centered).

Write each file to **exactly** the path below, relative to the repository root.
The
paths are fixed — the validator checks for a file at each one, and the review UI
shows it beside the matching reference. Capture them from the **built** game (serve
the production build, or your dev server) using the project-local Playwright that
`package.json` pins and `init` installs; do not hand-edit the media.

| Path | What it must show |
| --- | --- |
| `proof/title.png` | The title menu on load, with every menu item visible. |
| `proof/gameplay.png` | A live mid-crossing frame: the strait with the ice band (sliding hazards), the median, the water band (drifting floes), and the far shore with some **bays filled** and some open; the **critter** partway across (on a floe); the **bear** in pursuit (ideally swimming, shown as its silhouette + wake); and the HUD (score, lives, `LEVEL n / 8`, the timer). |
| `proof/game-over.png` | An end screen after a finished game — Game over or Victory — with the final score and level reached. |
| `proof/hunt.webm` | A short clip of the **hunter**: the bear emerging at the near shore and pursuing the critter across the strait — pathing **around a sliding hazard** on the ice, then **swimming out onto the water** after the critter (visible as a silhouette and wake), and finally **catching** a critter that hesitated or mis-stepped. The point is to show the bear chasing across the whole board and staying visible in the water. |
| `proof/cross.webm` | A short clip of a **crossing**: the critter hopping one tile at a time up through the ice band **dodging hazards**, riding **drifting floes** across the water (drifting with a floe, hopping floe to floe, not falling in), and reaching an **open bay** to fill it — all with the bear in pursuit behind it. |

Notes:

- Create the `proof/` directory if it does not exist.
- A screenshot must be a PNG; each clip must be a `.webm` of a few seconds — the
  format Playwright records natively (`recordVideo`), so no format conversion is
  needed.
- These files are **outputs** committed alongside the implementation — they are
  not
  part of the playable build and need not be served by it.
- Producing them is part of finishing the task: a missing proof is recorded against
  the run for the reviewer to see.
