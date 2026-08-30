// SCAFFOLD STUB — NOT A VALIDATOR.
//
// gravity/pull-direction — The pull is toward the star's centre
//
// The velocity a body at rest gains over one tick points at the star's centre
// within one degree, sampled from four bearings.
//
// Declared by test-case.toml as validation.script "gravity/pull-
// direction.test.ts", so the manifest resolves only while this file exists.
// The Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the simple-2d harness in validation/simple-2d/harness.ts and
// the spec-derived oracle in validation/simple-2d/geometry.ts — never against
// a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/gravity/pull-direction.test.ts is a scaffold stub and has not been written yet",
);
