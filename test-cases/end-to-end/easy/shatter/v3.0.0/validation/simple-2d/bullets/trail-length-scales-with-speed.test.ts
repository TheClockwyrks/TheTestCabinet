// SCAFFOLD STUB — NOT A VALIDATOR.
//
// bullets/trail-length-scales-with-speed — The trail is a slice of time, not of distance
//
// The drawn trail behind a bullet at 900 units per second is measurably longer
// than behind one at 300, in the ratio of their speeds within 25 percent.
//
// Declared by test-case.toml as validation.script "bullets/trail-length-
// scales-with-speed.test.ts", so the manifest resolves only while this file
// exists. The Validators stage of the v3.0.0 rework replaces it with the real
// suite, written against the simple-2d harness in
// validation/simple-2d/harness.ts and the spec-derived oracle in
// validation/simple-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/bullets/trail-length-scales-with-speed.test.ts is a scaffold stub and has not been written yet",
);
