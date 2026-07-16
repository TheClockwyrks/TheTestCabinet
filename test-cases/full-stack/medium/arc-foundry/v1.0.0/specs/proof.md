# Arc Foundry — Proof of implementation

As part of the finished build, capture **proof of implementation**: a small set of
screenshots and two short clips that evidence the game runs and the called-out systems
and produced assets work. A viewer compares each against the reference mockup for the
same screen, so frame each capture the way the references do (the full `1280 x 720`
stage, fitted and centered).

Write each file to **exactly** the path below, relative to the repository root. The paths
are fixed — the validator checks for a file at each one, and the review UI shows it beside
the matching reference. Capture them from the **built** game (serve the production
build, or your dev server) using the project-local Playwright that `package.json` pins
and `init` installs; do not hand-edit the media.

| Path | What it must show |
| --- | --- |
| `proof/title.png` | The title menu on load, with every menu item visible. |
| `proof/gameplay.png` | A live mid-wave frame on one of the maps (see specs/board): the map's ordered waypoints (their 4-tile platforms), a **maze** of kept components + inert **blockers** with the Load routing the shortest open route around it, more than one component **type** and more than one **quality tier** on the board (produced sprites, finish escalating Scrap→Tesla-Prime), at least one electrical VFX mid-fire (an arc bolt, chain-lightning, spark spray, or a discharge ring), and the full HUD — the status bar (Charge, Grid Integrity, wave indicator) and the build panel (the scrap-press, the UPGRADE QUALITY control, and either the selected candidate/component inspector or the next-wave preview). |
| `proof/game-over.png` | The **Overload** screen after Grid Integrity reached 0 (see specs/flow), with the wave reached shown (there is no score — a defeat has no Maze Rating). |
| `proof/systems.webm` | A short clip of the **scrap-press build loop** at work in the build phase (see specs/build): placing rocks that **roll a random component on placement** onto legal 2×2 footprints (with the build-spark VFX), the combinable rolls **pulsing** to show what can merge; taking a level's single harvest — a **KEEP** of one roll followed by **SEND** on one build phase, and on another a **COMBINE SPECIAL** folding that phase's matching rolls one tier higher (its combine-flash firing) which **ends the build phase and launches the wave** itself; an **UPGRADE QUALITY** purchase raising the Refinement level; and the unkept rolls hardening into inert **blockers** so the Load takes the shortest **open** route around the new maze between the waypoints — with the produced electrical VFX firing on each event. |
| `proof/pressure.webm` | A short clip of **late-wave pressure**: a dense wave (ideally a milestone wave with the **Dynamo** boss crossing the yard) with chain-lightning and discharge VFX firing on the packed Load, Grid Integrity dropping on leaks with the leak-alarm surge at the Collector, and the low-integrity alert showing. Let the produced audio (the industrial-electro bed and the fire/leak cues, see specs/assets) play if it will be captured. |

Notes:

- Create the `proof/` directory if it does not exist.
- A screenshot must be a PNG; each clip must be a `.webm` of a few seconds — the format
  Playwright records natively (`recordVideo`), so no format conversion is needed.
- These files are **outputs** committed alongside the implementation — they are not part
  of the playable build and need not be served by it.
- Producing them is part of finishing the task: a missing proof is recorded against the
  run for the viewer to see.
