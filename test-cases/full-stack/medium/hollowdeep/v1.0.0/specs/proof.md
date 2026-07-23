# Hollowdeep — Proof of implementation

As part of the finished build, capture **proof of implementation**: a small set of
screenshots and two short clips that evidence the game runs and the called-out
systems and produced assets work. A viewer compares each against the reference
mockup for the same screen, so frame each capture the way the references do (the full
`1280 x 720` stage, fitted and centered).

Write each file to **exactly** the path below, relative to the repository root. The
paths are fixed, so each capture lines up with the matching reference. Capture them
from the **built** game (serve the production build, or your dev server) using the
project-local Playwright that `package.json` pins and `init` installs; do not
hand-edit the media.

| Path | What it must show |
| --- | --- |
| `proof/title.png` | The title menu on load, with every menu item visible. |
| `proof/gameplay.png` | A live in-colony frame: a dug-out colony with delvers (drawn from the produced animation), tiles and at least one machine (produced sprites), the live gas overlay showing oxygen and CO2, and the full HUD dashboard (top-strip vitals — oxygen, CO2, power, stocks, cycle — and the bottom-strip delver roster and build palette). |
| `proof/game-over.png` | The colony-lost screen after the last delver has died, with the cycles survived shown. |
| `proof/systems.webm` | A short clip of the **colony systems** at work: queuing a dig and a delver walking to it and mining it (dig dust puffing) so the tile opens and yields a resource, refining/building something from that material, and a powered machine running — with the gas overlay visibly responding as space opens or a diffuser adds air. |
| `proof/survival.webm` | A short clip of the **survival pressure**: the air trending down (or a room souring) with the low-oxygen alert, and — ideally — a delver in danger fleeing toward better air or the colony reaching its loss state. Let the produced audio play if it will be captured. |

Notes:

- Create the `proof/` directory if it does not exist.
- A screenshot must be a PNG; each clip must be a `.webm` of a few seconds — the
  format Playwright records natively (`recordVideo`), so no format conversion is
  needed.
- These files are **outputs** committed alongside the implementation — they are not
  part of the playable build and need not be served by it.
- Producing them is part of finishing the task: a missing proof is recorded against
  the run for the viewer to see.
