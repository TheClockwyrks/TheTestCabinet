# Wireworm — the `simple-2d` reference implementation

PLACEHOLDER. The scaffold stage created this directory so the manifest resolves;
the reference stage replaces it with the authored correct build for the `simple-2d`
engine, seeded from `workspaces/simple-2d/` and completed against the specification.

A reference is never seeded into a run. It is the authored answer, built with the
case's own `[build]` commands, held to the same four toolchain gates a run is,
and driven by `tcab capture-baselines` to synthesize the baseline half of this
engine's validation media.
