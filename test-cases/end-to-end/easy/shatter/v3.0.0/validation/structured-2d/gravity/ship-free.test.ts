// SCAFFOLD STUB — NOT A VALIDATOR.
//
// gravity/ship-free — The well never pulls the ship
//
// A ship posed at rest 120 units from the star, with no thrust, is still at
// rest at the same centre after two seconds of game time.
//
// Declared by test-case.toml as validation.script "gravity/ship-free.test.ts",
// so the manifest resolves only while this file exists. The Validators stage
// of the v3.0.0 rework replaces it with the real suite, written against the
// structured-2d harness in validation/structured-2d/harness.ts and the spec-
// derived oracle in validation/structured-2d/geometry.ts — never against a
// reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/gravity/ship-free.test.ts is a scaffold stub and has not been written yet",
);
