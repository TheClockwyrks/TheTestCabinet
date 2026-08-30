// SCAFFOLD STUB — NOT A VALIDATOR.
//
// saucer/weave-interval — The weave rerolls about once a second
//
// With travel off, the time between two changes of the vertical velocity is
// SAUCER_WEAVE_INTERVAL (1.0 s), within 20 percent.
//
// Declared by test-case.toml as validation.script "saucer/weave-
// interval.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the simple-2d harness in validation/simple-2d/harness.ts and
// the spec-derived oracle in validation/simple-2d/geometry.ts — never against
// a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/saucer/weave-interval.test.ts is a scaffold stub and has not been written yet",
);
