# Junction — Proof of implementation

As part of the finished build, capture **proof of implementation**: a small set of
screenshots and two short clips that evidence the game runs and the called-out systems
and produced assets work. A reviewer compares each against the reference mockup for the
same screen, so frame each capture the way the references do (the full `1280 x 720`
stage, fitted and centered).

Write each file to **exactly** the path below, relative to the repository root. The
paths are fixed — the validator checks for a file at each one, and the review UI shows
it beside the matching reference. Capture them from the **built** game (serve the
production build, or your dev server) using the project-local Playwright that
`package.json` pins and `init` installs; do not hand-edit the media.

| Path | What it must show |
| --- | --- |
| `proof/title.png` | The title menu on load, with every menu item visible. |
| `proof/gameplay.png` | A live in-city frame: a developed city with the three zones at more than one density tier (produced sprites), roads and at least one rail line with a station, power/water tiles, moving vehicles, the pollution haze over industry (produced particles), and the full HUD dashboard (top-strip vitals — treasury, balance, population, power, water, clock — and the bottom-strip RCI meters and build palette). |
| `proof/game-over.png` | The bankruptcy screen after the city has gone broke, with the final tally (peak population and periods survived) shown. |
| `proof/systems.webm` | A short clip of the **city systems** at work: zoning some land and laying road/rail/utilities to it so it **develops** (construction dust puffing, buildings rising through tiers), vehicles pathing across the network, and the **traffic overlay** showing a corridor congesting — ideally eased by a rail line — with the RCI meters and utility balances responding. |
| `proof/crisis.webm` | A short clip of the **budget pressure**: the per-period balance going negative and the treasury falling (or a network over-drawing) with the alert showing, and — ideally — the city sliding toward, or reaching, bankruptcy. Let the produced audio play if it will be captured. |

Notes:

- Create the `proof/` directory if it does not exist.
- A screenshot must be a PNG; each clip must be a `.webm` of a few seconds — the format
  Playwright records natively (`recordVideo`), so no format conversion is needed.
- These files are **outputs** committed alongside the implementation — they are not part
  of the playable build and need not be served by it.
- Producing them is part of finishing the task: a missing proof is recorded against the
  run for the reviewer to see.
