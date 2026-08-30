// SCAFFOLD STUB — NOT A VALIDATOR.
//
// bullets/fire-rate — Shots are gated to one every 22 ticks
//
// Holding fire for one second of game time takes 120 / FIRE_INTERVAL_TICKS
// shots, within one.
//
// Declared by test-case.toml as validation.script "bullets/fire-rate.test.ts",
// so the manifest resolves only while this file exists. The Validators stage
// of the v3.0.0 rework replaces it with the real suite, written against the
// simple-2d harness in validation/simple-2d/harness.ts and the spec-derived
// oracle in validation/simple-2d/geometry.ts — never against a reference
// build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/bullets/fire-rate.test.ts is a scaffold stub and has not been written yet",
);
