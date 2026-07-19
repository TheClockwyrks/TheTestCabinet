Upgraded to the instrumented, automatically-validated format, and the seeded
specification was cleaned up throughout.

## Instrumentation and automated validation

- The build now exposes a deterministic, steppable, seedable core and a
  `window.__spectra` debugging and automation API (core `reset`/`step`/`snapshot`,
  a manual step clock via `setAutoStep`, and case-specific control and input
  operations), plus a read-only debug overlay. A new seeded `specs/instrumentation.md`
  documents the whole surface as an ordinary developer affordance of the game. The
  handle is a required, gating deliverable.
- The reviewer checklist moves to the categories grammar, with per-item automated
  validation scripts that drive the debug API against the build to decide verdicts
  and synthesize side-by-side proof media. The checklist is broken into many
  narrowly-scoped items, one observable behavior each, covering the edge cases the
  specs no longer call out.

## Specification cleanup

- Specs were renamed and re-split to fit this game: `enemies.md` became
  `drones.md`, and `flow.md` was split into `stages.md` (stages, challenge stages,
  scoring, lives, scaling) and `states.md` (game states, HUD, audio).
- Removed historical and prior-version framing, most bold emphasis and em-dash
  asides, enumerated edge-case call-outs (now covered by review items), and the
  prescriptive "verify before you finish" guidance in the prompt. The prompt's
  browser tooling section is now neutral: it states what is installed and leaves
  whether and how far to validate to the model.
