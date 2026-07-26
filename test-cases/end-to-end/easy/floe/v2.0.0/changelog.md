## Added the `window.__floe` debug API and overlay

A new common spec, `specs/instrumentation.md`, adds a `window.__floe` debugging and
automation API and a read-only debug overlay, backed by the deterministic,
fixed-step, render-free core the simulation already runs on — `reset`/`step`/
`snapshot`, control operations to pose the run, and injected keyboard input. A new
mandatory deliverable, hence the major bump.

## The checklist is validated automatically

The reviewer checklist moves to the categories grammar with per-item validation
scripts that drive the real simulation through the debug handle, so the crossing,
the hazards, the water, the bays, the hunter, the progression, the scoring, and the
colors are checked automatically; feel, art, and audio stay human review.

## Other changes

- Cleaned the specifications so each reads as one self-contained, fully
  authoritative game: removed historical and "inspired by" framing, edge-case and
  gotcha call-outs, test-framing, and prescriptive verification advice, and folded
  the single mode into `specs/gameplay.md`.
