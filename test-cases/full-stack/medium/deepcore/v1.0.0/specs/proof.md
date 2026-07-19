# Deepcore: proof of implementation

As part of the finished build, capture proof of implementation: a small set of
screenshots and two short clips that evidence the game runs and the called-out systems
and produced assets work. Each capture is compared against the reference mockup for the
same screen, so frame each capture the way the references do (the full `1280 x 720`
stage, fitted and centered).

Write each file to exactly the path below, relative to the repository root. The paths
are fixed. Capture them from the built game (serve the production build, or your dev
server) using the project-local Playwright that `package.json` pins and `init` installs;
do not hand-edit the media.

| Path | What it must show |
| --- | --- |
| `proof/title.png` | The title menu on load, with every menu item visible. |
| `proof/mine.png` | A live mid-dig frame underground (see specs/world, specs/character): the miner mid-animation (drilling or thrusting), carved tunnels around it, more than one tile band or a visible band transition, at least one ore vein and ideally a material node, at least one particle VFX mid-fire (drill debris or jetpack exhaust), and the full HUD (Fuel, Hull, Cargo used over capacity, Credits, Depth, and the scanner indicator, which shows only when the scanner is locked onto a needed material in range, so capture it near one where it points the way). |
| `proof/surface.png` | The surface camp (see specs/world): the six buildings (including the Save Pad and Supply Depot), the miner at the surface, the rocket on the pad partway assembled (at least one component installed), and one building panel open, the Upgrade Shop (its seven tracks and prices) or the Launch Pad (the rocket checklist). |
| `proof/game-over.png` | An end screen, either the Victory screen after a launch or a Hardcore Game Over after a death (see specs/flow), with the run summary shown. |
| `proof/loop.webm` | A short clip of the core loop (see specs/mining, specs/character, specs/flow): the miner drilling down and sideways through rock (drill animation and debris VFX), collecting ore into cargo (the sparkle), jetpacking back up a shaft (jetpack animation and exhaust VFX), and at the surface selling at the Ore Market and buying an upgrade at the shop, the dig-sell-upgrade loop, with the produced audio playing if it will be captured. |
| `proof/core-run.webm` | A short clip of the climax (see specs/hazards, specs/rocket): extracting the Core Sample at the bottom (its extraction VFX and the destabilization countdown starting), ascending under the timer past lava, and at the surface fabricating the Ignition Core at the Launch Pad and the rocket launching into the Victory screen, the produced launch VFX and roar firing. |

Notes:

- Create the `proof/` directory if it does not exist.
- A screenshot must be a PNG; each clip must be a `.webm` of a few seconds, the format
  Playwright records natively (`recordVideo`), so no format conversion is needed.
- These files are outputs committed alongside the implementation; they are not part of
  the playable build and need not be served by it.
- Producing them is part of finishing the task; a missing proof is recorded against the
  run.
- Reaching the deep states quickly for the clips can use the debug and automation
  surface the build exposes (`specs/instrumentation.md`): its control operations fund
  Credits, grant gear, and place the miner, so the setup is fast-forwarded while the
  systems shown stay the real ones.
