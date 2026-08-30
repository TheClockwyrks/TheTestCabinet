// SCAFFOLD STUB — NOT A VALIDATOR.
//
// bullets/inherits-ship-velocity — A shot carries the ship's drift
//
// A bullet fired from a ship moving at 300 units per second across its own
// facing leaves with the vector sum of that drift and the muzzle velocity,
// within 3 percent.
//
// Declared by test-case.toml as validation.script "bullets/inherits-ship-
// velocity.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the structured-2d harness in
// validation/structured-2d/harness.ts and the spec-derived oracle in
// validation/structured-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/bullets/inherits-ship-velocity.test.ts is a scaffold stub and has not been written yet",
);
