// SCAFFOLD STUB — NOT A VALIDATOR.
//
// instrumentation/reset-restores-title — reset returns the game to its title values
//
// After a run has been posed with a score, lives, a wave, rocks, bullets and a
// saucer, reset() restores every declared field to the title value
// specs/instrumentation.md lists and leaves muted untouched.
//
// Declared by test-case.toml as validation.script "instrumentation/reset-
// restores-title.test.ts", so the manifest resolves only while this file
// exists. The Validators stage of the v3.0.0 rework replaces it with the real
// suite, written against the none harness in validation/none/harness.ts and
// the spec-derived oracle in validation/none/geometry.ts — never against a
// reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/instrumentation/reset-restores-title.test.ts is a scaffold stub and has not been written yet",
);
