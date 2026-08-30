// SCAFFOLD STUB — NOT A VALIDATOR.
//
// instrumentation/clear-torpedoes — clearTorpedoes empties the torpedoes alone
//
// clearTorpedoes() removes every torpedo and leaves the rocks, bullets, enemy
// bullets and saucer standing.
//
// Declared by variants/warhead.toml as validation.script
// "instrumentation/clear-torpedoes.test.ts", so the manifest resolves only
// while this file exists. The Validators stage of the v3.0.0 rework replaces
// it with the real suite, written against the none harness in
// validation/none/harness.ts and the spec-derived oracle in
// validation/none/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/instrumentation/clear-torpedoes.test.ts is a scaffold stub and has not been written yet",
);
