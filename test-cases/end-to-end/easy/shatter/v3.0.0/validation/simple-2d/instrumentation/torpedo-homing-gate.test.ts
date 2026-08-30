// SCAFFOLD STUB — NOT A VALIDATOR.
//
// instrumentation/torpedo-homing-gate — Homing off holds the torpedo's heading
//
// With setTorpedoHoming(id, false) a torpedo holds its heading past a rock
// squarely inside its forward cone; with it on, the same pose turns it onto
// that rock.
//
// Declared by variants/warhead.toml as validation.script
// "instrumentation/torpedo-homing-gate.test.ts", so the manifest resolves only
// while this file exists. The Validators stage of the v3.0.0 rework replaces
// it with the real suite, written against the simple-2d harness in
// validation/simple-2d/harness.ts and the spec-derived oracle in
// validation/simple-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/instrumentation/torpedo-homing-gate.test.ts is a scaffold stub and has not been written yet",
);
