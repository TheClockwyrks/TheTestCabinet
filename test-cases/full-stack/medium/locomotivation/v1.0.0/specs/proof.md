# Locomotivation — Proof of implementation

As part of the finished build, capture proof of implementation: a small set of
screenshots and two short clips that evidence the game runs and the called-out
systems and produced assets work. Frame each capture as the whole 1280 x 720 stage,
fitted and centered.

Write each file to exactly the path below, relative to the repository root. The
paths are fixed. Capture them from the built game (serve the production build, or
your dev server) using the project-local Playwright that `package.json` pins and
`init` installs; do not hand-edit the media.

| Path | What it must show |
| --- | --- |
| `proof/title.png` | The title screen on load, with every menu item visible. |
| `proof/yard.png` | A live in-level frame (see specs/world, specs/trains): the worker mid-animation carrying freight, at least one train on a track (ideally mid-crossing, with a crossing signal in a warning or danger state), a dispenser and a color-matched drop zone, and the full HUD (shift clock, per-color quota, lives, the carried-load weight bar, and the sprint bar). |
| `proof/bridge.png` | A bridge or forced-crossing frame (see specs/world, specs/levels): the worker on a bridge (or in a refuge bay) over the impassable gap, with the bridge's train on the lane, so the commitment reads. |
| `proof/results.png` | A result screen: either Level Complete (with the score breakdown) or Level Failed (with the fail reason), or the campaign Victory screen, with the summary shown. |
| `proof/haul.webm` | A short clip of the core loop (see specs/character, specs/cargo): picking up a color-matched package (the worker turning to face each direction and animating laden), crossing a live track between two telegraphed trains and reaching a refuge, running a loaded trip that costs the sprint, and delivering to the matching zone (the delivery burst and confirm), with produced audio if it will be captured. |
| `proof/last-train.webm` | A short clip of the destruction and finale beats (see specs/cargo, specs/trains): a package dropped on a track and shattered by a train (the required cargo-splinter VFX firing), and, on a level that offers one, the last train arriving and the worker boarding a flat-top car for the bonus as the shift ends (or, if a full board is impractical to capture, the last train running its derived path with the flat-tops clearly distinct). |

Notes:

- Create the `proof/` directory if it does not exist.
- A screenshot must be a PNG; each clip must be a `.webm` of a few seconds, the
  format Playwright records natively (`recordVideo`), so no format conversion is
  needed.
- These files are outputs committed alongside the implementation; they are not part
  of the playable build and need not be served by it.
- Producing them is part of finishing the task.
- Reaching the states quickly for the clips is expected to use the debug and
  automation API the build exposes (`specs/instrumentation.md`): jump to a level,
  fund progress, position the worker, or bring the last train on early. The
  underlying systems shown must be the real ones, only their setup fast-forwarded.
