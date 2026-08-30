// SCAFFOLD STUB — NOT A VALIDATOR.
//
// flight/speed-cap — The ship's speed is capped
//
// A ship posed at SHIP_MAX (680) and thrusting for two seconds never exceeds
// SHIP_MAX by more than 1 unit per second.
//
// Declared by test-case.toml as validation.script "flight/speed-cap.test.ts",
// so the manifest resolves only while this file exists. The Validators stage
// of the v3.0.0 rework replaces it with the real suite, written against the
// simple-2d harness in validation/simple-2d/harness.ts and the spec-derived
// oracle in validation/simple-2d/geometry.ts — never against a reference
// build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/flight/speed-cap.test.ts is a scaffold stub and has not been written yet",
);
