# Floe v3.0.0 — the `structured-2d` reference implementation

**PLACEHOLDER — this reference has not been written yet.**

The Scaffold stage created this directory because `variants/base.toml` names it
in `[reference_implementation]` and manifest resolution requires it to exist.
The References stage of the Floe v3.0.0 rework replaces it with the authored
correct build for the `structured-2d` engine: the seeded workspace of the same name, with
the game written into it, its own copy of `assets/` at the root so it builds and
runs on its own, and a committed `package-lock.json`.

Nothing here is ever seeded into a run. This is the answer, held to the same four
toolchain gates a run is, and it is what `tcab capture-baselines` drives to
synthesize the baseline half of the validation media for this engine.
