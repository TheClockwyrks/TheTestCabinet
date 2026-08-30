// SCAFFOLD STUB — NOT A VALIDATOR.
//
// flight/thrust-along-facing — Thrust acts along the facing
//
// Holding thrust from rest at each of four facings leaves the velocity
// pointing along that facing within one degree.
//
// Declared by test-case.toml as validation.script "flight/thrust-along-
// facing.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the structured-2d harness in
// validation/structured-2d/harness.ts and the spec-derived oracle in
// validation/structured-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/flight/thrust-along-facing.test.ts is a scaffold stub and has not been written yet",
);
