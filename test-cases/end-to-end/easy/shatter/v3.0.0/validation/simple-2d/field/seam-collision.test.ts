// SCAFFOLD STUB — NOT A VALIDATOR.
//
// field/seam-collision — Bodies touching across a seam collide
//
// A bullet posed just inside the left edge, travelling left, destroys a rock
// posed just inside the right edge on the same row.
//
// Declared by test-case.toml as validation.script "field/seam-
// collision.test.ts", so the manifest resolves only while this file exists.
// The Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the simple-2d harness in validation/simple-2d/harness.ts and
// the spec-derived oracle in validation/simple-2d/geometry.ts — never against
// a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/field/seam-collision.test.ts is a scaffold stub and has not been written yet",
);
