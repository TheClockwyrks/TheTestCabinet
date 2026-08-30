// SCAFFOLD STUB — NOT A VALIDATOR.
//
// gravity/pull-magnitude — The pull follows the inverse-square law
//
// A bullet posed at rest at each of 200, 150 and 120 units from the star gains
// velocity over one tick within 5 percent of MU / d^2 x TICK_DT.
//
// Declared by test-case.toml as validation.script "gravity/pull-
// magnitude.test.ts", so the manifest resolves only while this file exists.
// The Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the none harness in validation/none/harness.ts and the spec-
// derived oracle in validation/none/geometry.ts — never against a reference
// build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/gravity/pull-magnitude.test.ts is a scaffold stub and has not been written yet",
);
