# Midway — Proof of implementation

As part of the finished build, capture **proof of implementation**: a small set of
screenshots and two short clips that evidence the game runs and the called-out
systems and produced assets work. A reviewer compares each against the reference
mockup for the same screen, so frame each capture the way the references do (the full
`1280 x 720` stage, fitted and centered).

Write each file to **exactly** the path below, relative to the repository root. The
paths are fixed — the validator checks for a file at each one, and the review UI shows
it beside the matching reference. Capture them from the **built** game (serve the
production build, or your dev server) using the project-local Playwright that
`package.json` pins and `init` installs; do not hand-edit the media.

| Path | What it must show |
| --- | --- |
| `proof/title.png` | The title menu on load, with every menu item visible. |
| `proof/gameplay.png` | A live in-park frame: paths busy with guests (drawn from the produced animation), at least one ride and one stall (produced sprites, the ride animating and steam/sparkle playing), scenery, and the full HUD dashboard (top-strip vitals — cash, guests, rating, happiness, day — and the bottom-strip build palette and context panel). |
| `proof/game-over.png` | The park-closed (bankruptcy) screen, with the days operated shown. |
| `proof/systems.webm` | A short clip of the **park systems** at work: guests entering and pathing to a ride, a queue forming and the ride loading/running/unloading, a purchase at a stall (coin cue), a ride breaking down and a mechanic repairing it, and a janitor clearing litter (cleanup puff). |
| `proof/downturn.webm` | A short clip of the **financial and reputation pressure**: prices too high (or rides breaking and litter piling), so happiness and the rating drop, the arrival rate falls, cash bleeds into the red, and — ideally — the park reaches its bankruptcy loss state. Let the produced audio play if it will be captured. |

Notes:

- Create the `proof/` directory if it does not exist.
- A screenshot must be a PNG; each clip must be a `.webm` of a few seconds — the
  format Playwright records natively (`recordVideo`), so no format conversion is
  needed.
- These files are **outputs** committed alongside the implementation — they are not
  part of the playable build and need not be served by it.
- Producing them is part of finishing the task: a missing proof is recorded against
  the run for the reviewer to see.
