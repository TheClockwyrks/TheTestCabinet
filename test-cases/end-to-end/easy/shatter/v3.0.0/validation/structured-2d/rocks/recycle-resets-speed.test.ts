// SCAFFOLD STUB — NOT A VALIDATOR.
//
// rocks/recycle-resets-speed — A recycled rock gets a fresh drift speed
//
// A Large slung through the star at 400 units per second re-enters at a speed
// inside [60, 110], so repeated recycling never accelerates it.
//
// Declared by test-case.toml as validation.script "rocks/recycle-resets-
// speed.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the structured-2d harness in
// validation/structured-2d/harness.ts and the spec-derived oracle in
// validation/structured-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/rocks/recycle-resets-speed.test.ts is a scaffold stub and has not been written yet",
);
