// SCAFFOLD STUB — NOT A VALIDATOR.
//
// waves/spawns-clear-of-the-ship — A wave spawns clear of the ship
//
// Every rock a wave spawns is at least WAVE_MIN_SHIP_DIST (300) from the ship
// by shortest wrapped distance.
//
// Declared by test-case.toml as validation.script "waves/spawns-clear-of-the-
// ship.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the structured-2d harness in
// validation/structured-2d/harness.ts and the spec-derived oracle in
// validation/structured-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/waves/spawns-clear-of-the-ship.test.ts is a scaffold stub and has not been written yet",
);
