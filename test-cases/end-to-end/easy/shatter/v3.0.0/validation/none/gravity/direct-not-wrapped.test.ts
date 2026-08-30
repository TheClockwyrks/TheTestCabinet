// SCAFFOLD STUB — NOT A VALIDATOR.
//
// gravity/direct-not-wrapped — The pull uses the direct vector, not a wrapped one
//
// A rock posed 40 units inside a corner is pulled toward the star's centre
// across the field rather than toward the nearest wrapped image of it, and its
// acceleration matches the direct distance.
//
// Declared by test-case.toml as validation.script "gravity/direct-not-
// wrapped.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the none harness in validation/none/harness.ts and the spec-
// derived oracle in validation/none/geometry.ts — never against a reference
// build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/gravity/direct-not-wrapped.test.ts is a scaffold stub and has not been written yet",
);
