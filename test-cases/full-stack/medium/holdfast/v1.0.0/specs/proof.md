# Holdfast — Proof of implementation

As part of the finished build, capture **proof of implementation**: a small set of
screenshots and two short clips that evidence the game runs and the called-out systems
and produced assets work. A viewer compares each against the reference mockup for the
same screen, so frame each capture the way the references do (the full `1280 x 720`
stage, fitted and centered).

Write each file to **exactly** the path below, relative to the repository root. The paths
are fixed, so each capture lines up with the matching reference. Capture them from the
**built** game (serve the production build, or your dev server) using the project-local
Playwright that `package.json` pins and `init` installs; do not hand-edit the media.

| Path | What it must show |
| --- | --- |
| `proof/title.png` | The title menu on load, with every menu item visible. |
| `proof/gameplay.png` | A live in-colony frame: a working colony with settlers (drawn from the produced animation), terrain and resource nodes and at least one structure (produced sprites), and the full HUD dashboard (top-strip vitals — stocks, day/time clock, and the threat state — and the bottom-strip settler roster and build palette). |
| `proof/game-over.png` | The colony-lost screen after the last settler has died, with the days survived shown. |
| `proof/colony.webm` | A short clip of the **colony systems** at work: designating a chop/mine and a settler walking to it and working it (dust puffing) so the node clears and yields a resource, hauling/building something from that material, and a farm or stove producing food — the everyday economy running. |
| `proof/raid.webm` | A short clip of a **raid**: the threat warning, raiders entering and advancing, ranged fire from settlers and/or a turret with muzzle flashes and impacts (the produced particle effects), a settler taking cover behind a wall, and — ideally — a settler downed or the colony reaching its loss state. Let the produced audio play if it will be captured. |

Notes:

- Create the `proof/` directory if it does not exist.
- A screenshot must be a PNG; each clip must be a `.webm` of a few seconds — the format
  Playwright records natively (`recordVideo`), so no format conversion is needed.
- These files are **outputs** committed alongside the implementation — they are not part
  of the playable build and need not be served by it.
- Producing them is part of finishing the task: a missing proof is recorded against the
  run for the viewer to see.
