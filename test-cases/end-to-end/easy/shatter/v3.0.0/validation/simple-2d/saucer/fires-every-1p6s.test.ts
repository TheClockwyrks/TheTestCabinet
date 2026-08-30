// SCAFFOLD STUB — NOT A VALIDATOR.
//
// saucer/fires-every-1p6s — The saucer fires on its own cadence
//
// With its mind and travel off, a saucer adds one enemy bullet every
// SAUCER_FIRE_INTERVAL (1.6 s), within 10 percent, over five shots.
//
// Declared by test-case.toml as validation.script "saucer/fires-
// every-1p6s.test.ts", so the manifest resolves only while this file exists.
// The Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the simple-2d harness in validation/simple-2d/harness.ts and
// the spec-derived oracle in validation/simple-2d/geometry.ts — never against
// a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/saucer/fires-every-1p6s.test.ts is a scaffold stub and has not been written yet",
);
