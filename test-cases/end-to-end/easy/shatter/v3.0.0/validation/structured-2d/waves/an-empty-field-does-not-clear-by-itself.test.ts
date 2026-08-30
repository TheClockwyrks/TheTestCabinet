// SCAFFOLD STUB — NOT A VALIDATOR.
//
// waves/an-empty-field-does-not-clear-by-itself — An emptied field is not a cleared wave
//
// A field emptied with clearRocks, from which nothing was destroyed, raises no
// banner and advances no wave over ten seconds.
//
// Declared by test-case.toml as validation.script "waves/an-empty-field-does-
// not-clear-by-itself.test.ts", so the manifest resolves only while this file
// exists. The Validators stage of the v3.0.0 rework replaces it with the real
// suite, written against the structured-2d harness in
// validation/structured-2d/harness.ts and the spec-derived oracle in
// validation/structured-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/waves/an-empty-field-does-not-clear-by-itself.test.ts is a scaffold stub and has not been written yet",
);
