# Siege — Proof of implementation

As part of the finished build, capture **proof of implementation**: a small set of
screenshots and one short clip that evidence the game runs and the called-out
features work. A viewer compares each against the reference mockup for the same
screen, so frame each capture the way the references do (the full game view,
fitted and centered, at a 16:9 window).

Write each file to **exactly** the path below, relative to the repository root.
The paths are fixed, so each capture lines up with the matching reference.
Capture them from the **built** game (serve the production build, or your dev
server) using the project-local Playwright that `package.json` pins and `init`
installs; do not hand-edit images.

Capturing a live first-person 3D game with Playwright takes a little driving:
launch Chromium (with `--no-sandbox`), size the viewport 16:9, load the build, and
script the input needed to reach each moment (click to lock the pointer, choose a
class/phase and deploy, wait for the assault, move and fire). A short scripted
sequence is expected.

| Path | What it must show |
| --- | --- |
| `proof/title.png` | The **title** screen on load: the `SIEGE` title and the **PLAY** and **HOW TO PLAY** options. |
| `proof/gameplay.png` | A live in-siege first-person frame: the weapon viewmodel and crosshair, Scourge attackers assaulting the active redoubt, and the HUD — health, ammo, the survival clock, the kill count, the **active redoubt health bar**, and the **squad panel**. Frame it during phase B or C if you can, so the tier accents and an **artillery telegraph** ring on the ground are visible. |
| `proof/game-over.png` | The **defeat** screen after redoubt C falls (or a forced end), showing the survival time and total kills. |
| `proof/assault.webm` | A short (a few seconds) screen recording of a live assault: a Scourge wave advancing and pathing over the terrain toward the redoubt, the player and squad firing and scoring kills, a **breaker** reaching the redoubt and its **health bar dropping**, and — if in phase B/C — an **artillery telegraph** appearing and a shell landing. Enough to show units path, fight, die, and grind the redoubt down. |
| `proof/wireframe.png` | A frame with **wireframe mode** enabled (`specs/flow.md`), showing the terrain and the character/weapon geometry as wireframe, so the generated geometry is visible. |

Notes:

- Create the `proof/` directory if it does not exist.
- A screenshot must be a PNG; the clip must be a `.webm` — the format Playwright
  records natively (`recordVideo`), so no format conversion is needed.
- These files are **outputs** committed alongside the implementation — they are
  not part of the playable build and need not be served by it.
- Producing them is part of finishing the task: a missing proof is recorded
  against the run for the viewer to see.
