// SCAFFOLD STUB — NOT A VALIDATOR.
//
// lives/game-over-at-zero — The last ship lost takes the counter to zero
//
// lives reads exactly 0 after the last ship is destroyed. The counter alone;
// the screen it puts up is screens/game-over-on-the-last-life's point.
//
// Declared by test-case.toml as validation.script "lives/game-over-at-
// zero.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the simple-2d harness in validation/simple-2d/harness.ts and
// the spec-derived oracle in validation/simple-2d/geometry.ts — never against
// a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/lives/game-over-at-zero.test.ts is a scaffold stub and has not been written yet",
);
