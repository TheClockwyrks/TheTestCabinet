// SCAFFOLD STUB — NOT A VALIDATOR.
//
// instrumentation/entity-ids — Every entity carries a distinct, stable id
//
// Each rock, bullet and enemy bullet added takes an id distinct from every
// other live entity's, appears last in its own roster, and keeps that id
// across advances.
//
// Declared by test-case.toml as validation.script "instrumentation/entity-
// ids.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the structured-2d harness in
// validation/structured-2d/harness.ts and the spec-derived oracle in
// validation/structured-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/instrumentation/entity-ids.test.ts is a scaffold stub and has not been written yet",
);
