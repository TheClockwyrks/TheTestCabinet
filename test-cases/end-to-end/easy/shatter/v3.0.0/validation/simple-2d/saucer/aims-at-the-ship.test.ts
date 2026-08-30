// SCAFFOLD STUB — NOT A VALIDATOR.
//
// saucer/aims-at-the-ship — The saucer aims at the ship
//
// With its mind and travel off and the ship posed 400 units away, the mean
// bearing of sixty shots is the bearing to the ship within 3 degrees. The
// bound is derived from the specification and the sample size, never from a
// reference run: specs/saucer.md fixes the per-shot error as a uniform draw
// over plus or minus SAUCER_AIM_ERROR, whose standard deviation is E / sqrt(3)
// = 5.77 degrees, so the mean of n shots has a standard error of E / sqrt(3n)
// = 0.745 degrees at n = 60, and 3 degrees is four standard errors.
//
// Declared by test-case.toml as validation.script "saucer/aims-at-the-
// ship.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the simple-2d harness in validation/simple-2d/harness.ts and
// the spec-derived oracle in validation/simple-2d/geometry.ts — never against
// a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/saucer/aims-at-the-ship.test.ts is a scaffold stub and has not been written yet",
);
