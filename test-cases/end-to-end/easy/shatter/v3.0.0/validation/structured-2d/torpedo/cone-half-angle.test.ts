// SCAFFOLD STUB — NOT A VALIDATOR.
//
// torpedo/cone-half-angle — The cone reaches 15 degrees off the heading
//
// A rock 14 degrees off the launch centre line is acquired and destroyed; one
// 16 degrees off is not.
//
// Declared by variants/warhead.toml as validation.script "torpedo/cone-half-
// angle.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the structured-2d harness in
// validation/structured-2d/harness.ts and the spec-derived oracle in
// validation/structured-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/torpedo/cone-half-angle.test.ts is a scaffold stub and has not been written yet",
);
