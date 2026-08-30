// SCAFFOLD STUB — NOT A VALIDATOR.
//
// detonation/harmless-to-the-ship — A torpedo never harms the ship
//
// A torpedo driven through the ship with its contact gate on leaves the ship
// whole and the torpedo in flight.
//
// Declared by variants/warhead.toml as validation.script "detonation/harmless-
// to-the-ship.test.ts", so the manifest resolves only while this file exists.
// The Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the simple-2d harness in validation/simple-2d/harness.ts and
// the spec-derived oracle in validation/simple-2d/geometry.ts — never against
// a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/detonation/harmless-to-the-ship.test.ts is a scaffold stub and has not been written yet",
);
