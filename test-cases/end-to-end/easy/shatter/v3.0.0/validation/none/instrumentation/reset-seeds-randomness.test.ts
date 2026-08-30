// SCAFFOLD STUB — NOT A VALIDATOR.
//
// instrumentation/reset-seeds-randomness — reset seeds the game's randomness
//
// Two runs opened after reset({ seed: 7 }) spawn identical wave-1 layouts; a
// run opened after reset({ seed: 8 }) spawns a different one.
//
// Declared by test-case.toml as validation.script "instrumentation/reset-
// seeds-randomness.test.ts", so the manifest resolves only while this file
// exists. The Validators stage of the v3.0.0 rework replaces it with the real
// suite, written against the none harness in validation/none/harness.ts and
// the spec-derived oracle in validation/none/geometry.ts — never against a
// reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/instrumentation/reset-seeds-randomness.test.ts is a scaffold stub and has not been written yet",
);
