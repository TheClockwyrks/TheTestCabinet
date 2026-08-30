// SCAFFOLD STUB — NOT A VALIDATOR.
//
// presentation/extra-ship-indication — An awarded ship is announced
//
// A real kill carrying the score across a 10,000 boundary draws something on
// the field that was not there the tick before, for at least half a second.
//
// Declared by test-case.toml as validation.script "presentation/extra-ship-
// indication.test.ts", so the manifest resolves only while this file exists.
// The Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the none harness in validation/none/harness.ts and the spec-
// derived oracle in validation/none/geometry.ts — never against a reference
// build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/presentation/extra-ship-indication.test.ts is a scaffold stub and has not been written yet",
);
