// SCAFFOLD STUB — NOT A VALIDATOR.
//
// instrumentation/snapshot-shape — Snapshot reports the full documented shape
//
// On a posed field carrying a rock of each size, a bullet, an enemy bullet and
// a saucer, every field listed in the snapshot shape specs/instrumentation.md
// fixes is present with its documented type.
//
// Declared by test-case.toml as validation.script "instrumentation/snapshot-
// shape.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the none harness in validation/none/harness.ts and the spec-
// derived oracle in validation/none/geometry.ts — never against a reference
// build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/instrumentation/snapshot-shape.test.ts is a scaffold stub and has not been written yet",
);
