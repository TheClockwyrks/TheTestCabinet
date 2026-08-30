// SCAFFOLD STUB — NOT A VALIDATOR.
//
// flight/drag-halves-in-three-seconds — An un-thrusting ship halves its speed every three seconds
//
// A ship posed at 400 units per second with no thrust reports half that speed
// after SHIP_DRAG_HALFLIFE (3.0) seconds of game time, within 3 percent.
//
// Declared by test-case.toml as validation.script "flight/drag-halves-in-
// three-seconds.test.ts", so the manifest resolves only while this file
// exists. The Validators stage of the v3.0.0 rework replaces it with the real
// suite, written against the none harness in validation/none/harness.ts and
// the spec-derived oracle in validation/none/geometry.ts — never against a
// reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/flight/drag-halves-in-three-seconds.test.ts is a scaffold stub and has not been written yet",
);
