// SCAFFOLD STUB — NOT A VALIDATOR.
//
// instrumentation/advance-is-exact — Advancing moves exactly the time asked for
//
// Advancing n ticks moves simTime by exactly n x TICK_DT within one tick, and
// one second of game time covered as one advance and as 120 single-tick
// advances leaves simTime and a posed rock in the same place.
//
// Declared by test-case.toml as validation.script "instrumentation/advance-is-
// exact.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the structured-2d harness in
// validation/structured-2d/harness.ts and the spec-derived oracle in
// validation/structured-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/instrumentation/advance-is-exact.test.ts is a scaffold stub and has not been written yet",
);
