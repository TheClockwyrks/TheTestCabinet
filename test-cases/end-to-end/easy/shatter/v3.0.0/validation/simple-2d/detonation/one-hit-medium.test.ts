// SCAFFOLD STUB — NOT A VALIDATOR.
//
// detonation/one-hit-medium — A torpedo destroys a Medium outright
//
// A torpedo into a full-health Medium destroys it in one hit, leaving two
// Small.
//
// Declared by variants/warhead.toml as validation.script "detonation/one-hit-
// medium.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the simple-2d harness in validation/simple-2d/harness.ts and
// the spec-derived oracle in validation/simple-2d/geometry.ts — never against
// a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/detonation/one-hit-medium.test.ts is a scaffold stub and has not been written yet",
);
