// SCAFFOLD STUB — NOT A VALIDATOR.
//
// rocks/drift-speed-large — A Large spawns inside its speed range
//
// Every Large a wave spawns has a speed in [60, 110] scaled by that wave's
// multiplier, within 2 percent.
//
// Declared by test-case.toml as validation.script "rocks/drift-speed-
// large.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the none harness in validation/none/harness.ts and the spec-
// derived oracle in validation/none/geometry.ts — never against a reference
// build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/rocks/drift-speed-large.test.ts is a scaffold stub and has not been written yet",
);
