// SCAFFOLD STUB — NOT A VALIDATOR.
//
// saucer/at-most-one-at-a-time — Only one saucer is up at a time
//
// Sampled every tick across two minutes of game time with spawning on, the
// reported saucer.id never changes from one live saucer to another without a
// tick reporting saucer null between the two visits, so a build whose spawner
// starts a second visit over a live one fails.
//
// Declared by test-case.toml as validation.script "saucer/at-most-one-at-a-
// time.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the none harness in validation/none/harness.ts and the spec-
// derived oracle in validation/none/geometry.ts — never against a reference
// build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/saucer/at-most-one-at-a-time.test.ts is a scaffold stub and has not been written yet",
);
