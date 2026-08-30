// SCAFFOLD STUB — NOT A VALIDATOR.
//
// bullets/max-four — At most four bullets exist at once
//
// With four of the ship's bullets in flight, firing adds none until one
// expires.
//
// Declared by test-case.toml as validation.script "bullets/max-four.test.ts",
// so the manifest resolves only while this file exists. The Validators stage
// of the v3.0.0 rework replaces it with the real suite, written against the
// structured-2d harness in validation/structured-2d/harness.ts and the spec-
// derived oracle in validation/structured-2d/geometry.ts — never against a
// reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/bullets/max-four.test.ts is a scaffold stub and has not been written yet",
);
