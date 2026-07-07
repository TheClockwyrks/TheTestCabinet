# Caldera — Proof of implementation

As part of the finished build, capture **proof of implementation**: a small set of
screenshots and one short clip that evidence the game runs and the called-out
features work. A reviewer compares each against the reference mockup for the same
screen, so frame each capture the way the references do (the full game view, fitted
and centered, at a 16:9 window).

Write each file to **exactly** the path below, relative to the repository root. The
paths are fixed — the validator checks for a file at each one, and the review UI
shows it beside the matching reference. Capture them from the **built** game (serve
the production build, or your dev server) using the project-local Playwright that
`package.json` pins and `init` installs; do not hand-edit images.

Capturing a live 3D strategy game with Playwright takes a little driving: launch
Chromium (with `--no-sandbox`), size the viewport 16:9, load the build, and script
the input needed to reach each moment (start a run, pan/zoom the camera, build a few
structures, let a wave arrive). A short scripted sequence is expected. For the
in-game and assault captures, **start a later wave** (via the starting-wave prompt)
so the terrain is developed and the tier accents and a real assault are visible
without playing the openers.

| Path | What it must show |
| --- | --- |
| `proof/title.png` | The **title** screen on load: the `CALDERA` title and the **PLAY** and **HOW TO PLAY** options. |
| `proof/gameplay.png` | A live in-game frame from the **tilted RTS camera**: the generated hex caldera with visible **terraces and cliffs**, a river or lake, at least one **vent** with a **boiler**, water and steam **pipes** running to **towers**, and the full HUD — funds and income, the Core health, the wave counter, the steam readout, the build palette, and a selection panel. |
| `proof/terrain.png` | A close, tilted camera frame that clearly shows the terrain rendering: **terraced** single-level slopes, a **cliff** face where levels differ by two or more, the carved **river** channel with its animated water, and the procedural surface variation — so the hex-mesh generation is inspectable. |
| `proof/overlay.png` | A frame with the **fluid-network overlay** enabled (`specs/flow.md`), showing the water and steam networks with flow, the boilers and sources, and at least one tower's powered/brownout/dark state. |
| `proof/wireframe.png` | A frame with **wireframe mode** enabled (`specs/flow.md`), showing the terrain hex mesh (its terraces and cliffs) and the structure/unit geometry as wireframe, so the generated geometry is visible. |
| `proof/assault.webm` | A short (a few seconds) screen recording of a live wave: Slag spawning at a breach and **pathing over the terrain** — up terraces, around a cliff, wading a river — toward the Core, towers firing and destroying Slag, and either a **Sapper cutting a pipe** (a tower browning out) or a **Breaker/Colossus** being brought down by anti-armor fire. Enough to show units path, the towers fight, and the fluid network matter. |

Notes:

- Create the `proof/` directory if it does not exist.
- A screenshot must be a PNG; the clip must be a `.webm` — the format Playwright
  records natively (`recordVideo`), so no format conversion is needed.
- These files are **outputs** committed alongside the implementation — they are not
  part of the playable build and need not be served by it.
- Producing them is part of finishing the task: a missing proof is recorded against
  the run for the reviewer to see.
