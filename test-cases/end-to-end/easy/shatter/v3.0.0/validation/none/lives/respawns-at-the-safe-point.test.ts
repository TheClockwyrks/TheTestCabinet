// SCAFFOLD STUB — NOT A VALIDATOR.
//
// lives/respawns-at-the-safe-point — The next ship appears at the safe point
//
// After a death with lives remaining, the ship's centre is (SAFE_X, SAFE_Y)
// within one unit.
//
// Declared by test-case.toml as validation.script "lives/respawns-at-the-safe-
// point.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the none harness in validation/none/harness.ts and the spec-
// derived oracle in validation/none/geometry.ts — never against a reference
// build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/lives/respawns-at-the-safe-point.test.ts is a scaffold stub and has not been written yet",
);
