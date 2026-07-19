Upgraded to the instrumented, automatically-validated format.

- Added a `window.__floe` debugging and automation API and a read-only debug
  overlay, backed by the deterministic, fixed-step, render-free core the simulation
  already runs on: `reset`/`step`/`snapshot`, control operations to pose the run
  (start, level, lives, score, timer, bays, the critter, the lanes, and the bears),
  and injected keyboard input. Documented as an ordinary developer affordance in a
  new `specs/instrumentation.md`.
- Reworked the reviewer checklist into the categories grammar with per-item automated
  validation scripts that drive the real simulation through the debug handle, so the
  crossing, the hazards, the water, the bays, the hunter, the progression, the
  scoring, and the colors are checked automatically, with human review reserved for
  feel, art, and audio.
- Cleaned the specifications so each reads as one self-contained, fully authoritative
  game: removed historical and "inspired by" framing, edge-case and gotcha
  call-outs, test-framing, and prescriptive verification advice, and folded the
  single mode into `specs/flow.md`.
