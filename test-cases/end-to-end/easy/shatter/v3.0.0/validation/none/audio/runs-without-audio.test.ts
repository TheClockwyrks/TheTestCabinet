// SCAFFOLD STUB — NOT A VALIDATOR.
//
// audio/runs-without-audio — The game runs whether or not audio does
//
// The game runs, draws and is fully playable before any audio has started, and
// never fails to run if audio cannot start at all: with the audio bus
// unavailable, a full game is opened, flown, fired and scored, and every
// reading is what the same scenario gives with audio working.
//
// Declared by test-case.toml as validation.script "audio/runs-without-
// audio.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the none harness in validation/none/harness.ts and the spec-
// derived oracle in validation/none/geometry.ts — never against a reference
// build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/audio/runs-without-audio.test.ts is a scaffold stub and has not been written yet",
);
