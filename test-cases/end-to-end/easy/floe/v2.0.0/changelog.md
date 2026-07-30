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

## Every death pauses before the respawn

`specs/gameplay.md` now gives **every** death a brief pause of about `1 s` before the
fresh critter appears, rather than pausing only the bear's re-emergence. Without it a
build is free to resolve a death within the tick that caused it, which hands the fresh
critter straight back to a key the player has not yet let go of — a tap that drowns
you also walks you off the near shore before you can react. `specs/instrumentation.md`
anchors the snapshot's `phase` to that pause: `"dying"` is now defined as the death
pause (and `"crossing"` and `"clearing"` are defined alongside it), where before the
three were listed as possible values with nothing saying when each holds.

## Other changes

- Cleaned the specifications so each reads as one self-contained, fully
  authoritative game: removed historical and "inspired by" framing, edge-case and
  gotcha call-outs, test-framing, and prescriptive verification advice, and folded
  the single mode into `specs/gameplay.md`.
