// SCAFFOLD STUB — NOT A VALIDATOR.
//
// instrumentation/set-wave-spawns-nothing — Posing the wave spawns nothing
//
// setWave(n) changes the reported wave and leaves the rock roster exactly as
// it was, spawning nothing and clearing nothing.
//
// Declared by test-case.toml as validation.script "instrumentation/set-wave-
// spawns-nothing.test.ts", so the manifest resolves only while this file
// exists. The Validators stage of the v3.0.0 rework replaces it with the real
// suite, written against the simple-2d harness in
// validation/simple-2d/harness.ts and the spec-derived oracle in
// validation/simple-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/instrumentation/set-wave-spawns-nothing.test.ts is a scaffold stub and has not been written yet",
);
