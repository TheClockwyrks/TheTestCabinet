// SCAFFOLD STUB — NOT A VALIDATOR.
//
// star-core/ship-loses-its-inward-speed — The slide removes the inward motion
//
// The same contact leaves the component of the ship's velocity heading into
// the core at 0 within 5 units per second, so a build that zeroes the whole
// velocity and a build that reflects it fail different points.
//
// Declared by test-case.toml as validation.script "star-core/ship-loses-its-
// inward-speed.test.ts", so the manifest resolves only while this file exists.
// The Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the simple-2d harness in validation/simple-2d/harness.ts and
// the spec-derived oracle in validation/simple-2d/geometry.ts — never against
// a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/star-core/ship-loses-its-inward-speed.test.ts is a scaffold stub and has not been written yet",
);
