// SCAFFOLD STUB — NOT A VALIDATOR.
//
// lives/extra-ship-at-10000 — An extra ship is awarded at 10,000
//
// With the score posed just below 10,000, a real kill that carries it across
// raises lives by exactly one.
//
// Declared by test-case.toml as validation.script "lives/extra-ship-
// at-10000.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the simple-2d harness in validation/simple-2d/harness.ts and
// the spec-derived oracle in validation/simple-2d/geometry.ts — never against
// a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/lives/extra-ship-at-10000.test.ts is a scaffold stub and has not been written yet",
);
