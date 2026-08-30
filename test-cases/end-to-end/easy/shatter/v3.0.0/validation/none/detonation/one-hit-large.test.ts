// SCAFFOLD STUB — NOT A VALIDATOR.
//
// detonation/one-hit-large — A torpedo destroys a Large outright
//
// A torpedo into a full-health Large destroys it in one hit, leaving two
// Medium.
//
// Declared by variants/warhead.toml as validation.script "detonation/one-hit-
// large.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the none harness in validation/none/harness.ts and the spec-
// derived oracle in validation/none/geometry.ts — never against a reference
// build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/detonation/one-hit-large.test.ts is a scaffold stub and has not been written yet",
);
