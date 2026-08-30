// SCAFFOLD STUB — NOT A VALIDATOR.
//
// bullets/lifetime — A bullet expires after 1.5 seconds
//
// A bullet posed clear of everything is still in flight at 1.4 s of game time
// and gone by 1.6 s.
//
// Declared by test-case.toml as validation.script "bullets/lifetime.test.ts",
// so the manifest resolves only while this file exists. The Validators stage
// of the v3.0.0 rework replaces it with the real suite, written against the
// none harness in validation/none/harness.ts and the spec-derived oracle in
// validation/none/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/bullets/lifetime.test.ts is a scaffold stub and has not been written yet",
);
