// SCAFFOLD STUB — NOT A VALIDATOR.
//
// lives/extra-ship-at-20000 — An extra ship is awarded at every multiple
//
// The same test across the 20,000 boundary raises lives by exactly one, so the
// award repeats rather than firing once.
//
// Declared by test-case.toml as validation.script "lives/extra-ship-
// at-20000.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the structured-2d harness in
// validation/structured-2d/harness.ts and the spec-derived oracle in
// validation/structured-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/lives/extra-ship-at-20000.test.ts is a scaffold stub and has not been written yet",
);
