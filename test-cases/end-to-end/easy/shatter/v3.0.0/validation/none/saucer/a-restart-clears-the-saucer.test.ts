// SCAFFOLD STUB — NOT A VALIDATOR.
//
// saucer/a-restart-clears-the-saucer — A restart begins a game with no saucer
//
// From a game down to two ships with a saucer up, confirming RESTART on the
// pause menu gives a game reporting screen playing, saucer null the instant it
// starts and still null two seconds in, and lives back at START_LIVES; the
// saucer is asserted present at the pause, so its absence afterwards is the
// restart's doing.
//
// Declared by test-case.toml as validation.script "saucer/a-restart-clears-
// the-saucer.test.ts", so the manifest resolves only while this file exists.
// The Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the none harness in validation/none/harness.ts and the spec-
// derived oracle in validation/none/geometry.ts — never against a reference
// build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/saucer/a-restart-clears-the-saucer.test.ts is a scaffold stub and has not been written yet",
);
