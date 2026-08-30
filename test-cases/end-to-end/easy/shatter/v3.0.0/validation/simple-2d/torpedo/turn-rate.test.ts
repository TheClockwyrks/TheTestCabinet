// SCAFFOLD STUB — NOT A VALIDATOR.
//
// torpedo/turn-rate — A torpedo turns at 160 degrees per second
//
// Turning onto a target 90 degrees off, the heading changes at TORPEDO_TURN
// within 5 percent.
//
// Declared by variants/warhead.toml as validation.script "torpedo/turn-
// rate.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the simple-2d harness in validation/simple-2d/harness.ts and
// the spec-derived oracle in validation/simple-2d/geometry.ts — never against
// a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/torpedo/turn-rate.test.ts is a scaffold stub and has not been written yet",
);
