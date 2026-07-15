# Deepcore — Proof of implementation

As part of the finished build, capture **proof of implementation**: a small set of
screenshots and two short clips that evidence the game runs and the called-out systems
and produced assets work. A viewer compares each against the reference mockup for the
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
| `proof/mine.png` | A live mid-dig frame underground (see specs/world, specs/character): the miner **mid-animation** (drilling or thrusting), carved tunnels around it, more than one **tile band** or a visible band transition, at least one **ore vein** and ideally a **material node**, at least one particle VFX mid-fire (drill debris or jetpack exhaust), and the full HUD — Fuel, Hull, Cargo (used/capacity), Credits, Depth, and the scanner indicator. |
| `proof/surface.png` | The **surface camp** (see specs/world): the four buildings, the miner at the surface, the **rocket on the pad partway assembled** (at least one component installed), and one **building panel open** — the Upgrade Shop (its seven tracks + prices) or the Launch Pad (the rocket checklist). |
| `proof/game-over.png` | An **end screen** — either the **Victory** screen after a launch, or a **Hardcore Game Over** after a death (see specs/flow) — with the run summary shown. |
| `proof/loop.webm` | A short clip of the **core loop** (see specs/mining, specs/character, specs/flow): the miner **drilling down and sideways** through rock (drill animation + debris VFX), **collecting ore** into cargo (the sparkle), **jetpacking back up** a shaft (jetpack animation + exhaust VFX), and at the surface **selling** at the Ore Market and **buying an upgrade** at the shop — the dig→sell→upgrade loop, with the produced audio playing if it will be captured. |
| `proof/core-run.webm` | A short clip of the **climax** (see specs/hazards, specs/rocket): **extracting the Core Sample** at the bottom (its extraction VFX and the destabilization **countdown** starting), **ascending under the timer** past lava, and at the surface **fabricating the Ignition Core** at the Launch Pad and the rocket **LAUNCHING** into the Victory screen — the produced launch VFX and roar firing. |

Notes:

- Create the `proof/` directory if it does not exist.
- A screenshot must be a PNG; each clip must be a `.webm` of a few seconds — the format
  Playwright records natively (`recordVideo`), so no format conversion is needed.
- These files are **outputs** committed alongside the implementation — they are not part
  of the playable build and need not be served by it.
- Producing them is part of finishing the task: a missing proof is recorded against the
  run for the viewer to see.
- Reaching the deep states quickly for the clips is expected to use a small set of dev
  hooks (funding Credits, granting gear, teleporting the miner) exposed by the build for
  its own capture harness — the underlying systems shown must be the real ones, only
  their setup fast-forwarded.
