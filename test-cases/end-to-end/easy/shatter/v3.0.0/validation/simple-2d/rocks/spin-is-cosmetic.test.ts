// SCAFFOLD STUB — NOT A VALIDATOR.
//
// rocks/spin-is-cosmetic — A rock's spin does not move it
//
// A rock posed at rest on a cleared field is read a second of game time later:
// the bearing of its velocity and of its displacement each point at the star's
// centre within one degree, and the component of each across that bearing is 0
// within one unit per second and one unit. A drawn spin that leaks into the
// simulation shows up as exactly that tangential component.
//
// Declared by test-case.toml as validation.script "rocks/spin-is-
// cosmetic.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the simple-2d harness in validation/simple-2d/harness.ts and
// the spec-derived oracle in validation/simple-2d/geometry.ts — never against
// a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/rocks/spin-is-cosmetic.test.ts is a scaffold stub and has not been written yet",
);
