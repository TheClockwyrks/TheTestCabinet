// SCAFFOLD STUB — NOT A VALIDATOR.
//
// saucer/subsequent-gap — Later saucers arrive 25 to 35 seconds apart
//
// The interval between one saucer leaving and the next arriving lies in [25,
// 35] seconds, sampled across three seeds.
//
// Declared by test-case.toml as validation.script "saucer/subsequent-
// gap.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the none harness in validation/none/harness.ts and the spec-
// derived oracle in validation/none/geometry.ts — never against a reference
// build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/saucer/subsequent-gap.test.ts is a scaffold stub and has not been written yet",
);
