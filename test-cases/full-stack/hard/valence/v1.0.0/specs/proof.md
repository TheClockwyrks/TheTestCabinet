# Valence — Proof of implementation

As part of the finished build, capture **proof of implementation**: a small set of
screenshots and two short clips that evidence the game runs and the called-out systems and
produced assets work. A viewer compares each against the reference mockup for the same
screen, so frame each capture the way the references do (the full `1280 x 720` stage, fitted
and centered).

Write each file to **exactly** the path below, relative to the repository root. The paths
are fixed — the validator checks for a file at each one, and the review UI shows it beside
the matching reference. Capture them from the **built** game (serve the production
build, or your dev server) using the project-local Playwright that `package.json` pins
and `init`
installs; do not hand-edit the media.

| Path | What it must show |
| --- | --- |
| `proof/title.png` | The title menu on load, with every menu item visible. |
| `proof/gameplay.png` | A live mid-round frame: the conduit with its fork and merge, towers built on several grid cells (produced sprites), matter of more than one form on both lanes (produced atoms/molecules/heavy, drawn with electron shells / bonds / criticality), at least one decomposition burst mid-flight, and the full HUD — the status bar (energy, integrity, round) and the build panel (shop and either the inspector or the next-round preview). |
| `proof/game-over.png` | The containment-failed screen after integrity has reached zero, with the round reached and the final score shown. |
| `proof/systems.webm` | A short clip of the **decomposition model** at work: a Shear peeling a molecule into free atoms and ionizers stripping them, a Fission splitting a heavy into daughter atoms, and — if you can stage it — a Catalyst making an inert unit reactive so an ionizer finishes it, with the produced particle bursts firing on each event. |
| `proof/pressure.webm` | A short clip of **late-round pressure**: a dense round (ideally a milestone round with the Macromass boss fragmenting as it is fissioned) with integrity dropping on leaks and the low-integrity alert showing. Let the produced audio play if it will be captured. |

Notes:

- Create the `proof/` directory if it does not exist.
- A screenshot must be a PNG; each clip must be a `.webm` of a few seconds — the format
  Playwright records natively (`recordVideo`), so no format conversion is needed.
- These files are **outputs** committed alongside the implementation — they are not part of
  the playable build and need not be served by it.
- Producing them is part of finishing the task: a missing proof is recorded against the run
  for the viewer to see.
