// SCAFFOLD STUB — NOT A VALIDATOR.
//
// instrumentation/wave-spawning-gate — Wave spawning off leaves an emptied field empty
//
// With setWaveSpawning(false) a field emptied by shooting raises no banner,
// advances no wave and spawns no rock over ten seconds of game time; with it
// on, the same field turns over.
//
// Declared by test-case.toml as validation.script "instrumentation/wave-
// spawning-gate.test.ts", so the manifest resolves only while this file
// exists. The Validators stage of the v3.0.0 rework replaces it with the real
// suite, written against the structured-2d harness in
// validation/structured-2d/harness.ts and the spec-derived oracle in
// validation/structured-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/instrumentation/wave-spawning-gate.test.ts is a scaffold stub and has not been written yet",
);
