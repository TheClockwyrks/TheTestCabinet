// SCAFFOLD STUB — NOT A VALIDATOR.
//
// detonation/scatter-is-radial — The torpedo scatter blasts outward
//
// Each fragment's velocity, less the parent's, points away from the destroyed
// rock's centre within 10 degrees, rather than across the torpedo's travel.
//
// Declared by variants/warhead.toml as validation.script "detonation/scatter-
// is-radial.test.ts", so the manifest resolves only while this file exists.
// The Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the structured-2d harness in
// validation/structured-2d/harness.ts and the spec-derived oracle in
// validation/structured-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/detonation/scatter-is-radial.test.ts is a scaffold stub and has not been written yet",
);
