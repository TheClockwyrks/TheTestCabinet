// SCAFFOLD STUB — NOT A VALIDATOR.
//
// lives/respawn-only-with-lives-left — The last death puts no new ship up
//
// With setLives(1), a fatal contact puts no ship at the safe point: nothing is
// drawn there and the ship's reported centre does not return to (SAFE_X,
// SAFE_Y). The screen transition is screens/game-over-on-the-last-life's
// point, not this one.
//
// Declared by test-case.toml as validation.script "lives/respawn-only-with-
// lives-left.test.ts", so the manifest resolves only while this file exists.
// The Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the simple-2d harness in validation/simple-2d/harness.ts and
// the spec-derived oracle in validation/simple-2d/geometry.ts — never against
// a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/lives/respawn-only-with-lives-left.test.ts is a scaffold stub and has not been written yet",
);
