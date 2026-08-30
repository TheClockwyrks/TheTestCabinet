// SCAFFOLD STUB — NOT A VALIDATOR.
//
// presentation/invulnerable-ship-blinks — A ship in its grace reads as protected
//
// Over the grace window the ship's drawn appearance — the pixels inside SHIP_R
// of its centre, compared as an RGB distance out of 441 — differs measurably
// from its steady appearance at some sampled instant and matches it at
// another. Presence and difference, not one blink implementation: a build
// blinking by color, by outline weight or by alpha keeps its drawn pixel count
// roughly constant and is conformant.
//
// Declared by test-case.toml as validation.script "presentation/invulnerable-
// ship-blinks.test.ts", so the manifest resolves only while this file exists.
// The Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the simple-2d harness in validation/simple-2d/harness.ts and
// the spec-derived oracle in validation/simple-2d/geometry.ts — never against
// a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/presentation/invulnerable-ship-blinks.test.ts is a scaffold stub and has not been written yet",
);
