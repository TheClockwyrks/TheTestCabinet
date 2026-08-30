// SCAFFOLD STUB — NOT A VALIDATOR.
//
// saucer/aim-error-varies-per-shot — The aim error is redrawn for every shot
//
// Across those same sixty shots at a stationary ship the bearings are not all
// equal: their spread exceeds 4 degrees, which a uniform draw over plus or
// minus 10 degrees clears overwhelmingly and a build that aims dead-on, or
// reuses one offset, does not. specs/saucer.md states the draw as fresh per
// shot, which is the rule this item asserts.
//
// Declared by test-case.toml as validation.script "saucer/aim-error-varies-
// per-shot.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the simple-2d harness in validation/simple-2d/harness.ts and
// the spec-derived oracle in validation/simple-2d/geometry.ts — never against
// a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/saucer/aim-error-varies-per-shot.test.ts is a scaffold stub and has not been written yet",
);
