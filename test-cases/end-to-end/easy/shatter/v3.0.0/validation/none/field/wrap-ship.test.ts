// SCAFFOLD STUB — NOT A VALIDATOR.
//
// field/wrap-ship — The ship wraps at every edge
//
// A ship driven off each of the four edges re-enters at the opposite one, its
// centre wrapping modulo the field size.
//
// Declared by test-case.toml as validation.script "field/wrap-ship.test.ts",
// so the manifest resolves only while this file exists. The Validators stage
// of the v3.0.0 rework replaces it with the real suite, written against the
// none harness in validation/none/harness.ts and the spec-derived oracle in
// validation/none/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/field/wrap-ship.test.ts is a scaffold stub and has not been written yet",
);
