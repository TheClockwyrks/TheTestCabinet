# Task 6 — DEFERRED: publish & score failures as first-class results

**Status:** deferred — a separate, deliberate design pass, **not** part of the
per-run-Job refactor. Captured here so it isn't lost. Mirrors the memory
`failures-as-publishable-results.md`.

## The idea

As test cases grow, smaller models will legitimately produce unusable output
(non-building code, output that can't be evaluated). For a frontier benchmark
those catastrophic failures are *signal*, not noise — worth publishing, including
the generated broken code, so people can see *how* the agent failed. So
failed/unevaluable runs should become first-class, publishable, scored results.

This **reverses** the current "failed runs are excluded from scoring and never
publishable" stance.

## The non-negotiable distinction

- **Model-caused failure** — the agent produced non-building/unevaluable output,
  or burned its whole time/token budget. The model is the reason. **Publishable.**
- **Infrastructure-caused failure** — harness crashed, container wouldn't start,
  image couldn't be pulled, pod OOM-killed. The Test Cabinet is the reason.
  **Retain with a diagnostic reason; never publishable.**

`RunState::Failed` alone does not capture this (a runtime-cap timeout is
model-caused; a container failure is infra-caused). The design must add an
explicit **model-vs-infra classification** to the run record / validation.

## Scope (all deferred)

- **Classification:** add the model-vs-infra signal at the point a run fails.
- **Publish gate:** allow non-`completed` *model* outcomes; refuse infra failures.
  (This replaces the interim `completed`-only guard added in the refactor.)
- **Scoring model:** how a catastrophic failure scores — a floor? a distinct
  "failed-to-build" tier? — and how it aggregates into model comparisons.
- **Gallery rendering:** a published failure shows its `source_repo` but has no
  `playable_build` (it doesn't run); the run-detail and cards must render that.
- **Public push guard:** likely relax `POST /runs` (`completed`-only today) so the
  CLI/desktop path can push failures too.
- **Reviewer worklist:** failed/infra runs probably want filtering/labeling so the
  worklist isn't noisy.

## Already handled by the refactor (so this pass loses no data)

The backend retains **every** produced record regardless of outcome, with the
event timeline and a specific failure `detail`. Artifact retention (the
`tcab-artifacts` service, Phase 5, committed `099148b`) keeps the generated code. So when this pass is picked up, the data is all there —
it is purely a publish/scoring/UI design problem.
