// SCAFFOLD STUB — NOT A VALIDATOR.
//
// scoring/score-only-rises — The score never falls within a game
//
// On the quiet field startPlaying leaves, with both world gates off, every
// scoring event the game has is posed directly and the score is sampled every
// tick: a Large is shot down through its whole Medium and Small ladder, a
// saucer is added and shot, and one rock is slung into the star for a recycle.
// No sample is below the one before it.
//
// Declared by test-case.toml as validation.script "scoring/score-only-
// rises.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the none harness in validation/none/harness.ts and the spec-
// derived oracle in validation/none/geometry.ts — never against a reference
// build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/scoring/score-only-rises.test.ts is a scaffold stub and has not been written yet",
);
