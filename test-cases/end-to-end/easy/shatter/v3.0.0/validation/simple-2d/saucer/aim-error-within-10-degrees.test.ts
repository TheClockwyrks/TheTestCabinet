// SCAFFOLD STUB — NOT A VALIDATOR.
//
// saucer/aim-error-within-10-degrees — The aim error stays inside 10 degrees
//
// Every one of those sixty shots leaves within SAUCER_AIM_ERROR (10 degrees)
// of the bearing to the ship. The bound alone; the scatter is a separate item.
//
// Declared by test-case.toml as validation.script "saucer/aim-error-
// within-10-degrees.test.ts", so the manifest resolves only while this file
// exists. The Validators stage of the v3.0.0 rework replaces it with the real
// suite, written against the simple-2d harness in
// validation/simple-2d/harness.ts and the spec-derived oracle in
// validation/simple-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/saucer/aim-error-within-10-degrees.test.ts is a scaffold stub and has not been written yet",
);
