// SCAFFOLD STUB — NOT A VALIDATOR.
//
// instrumentation/clock-is-held — Nothing advances unless a step asks it to
//
// With the clock held, advancing nothing advances nothing: advance(0) under
// none, and engine.advance(0) under either engine, leaves simTime and every
// posed body exactly as they stood, which a build whose accumulator forces a
// minimum step, or which runs a tick on entry, fails. Under none the item
// carries a second leg: a second of real wall time with setAutoStep(false) and
// no advance leaves the same reading.
//
// Declared by test-case.toml as validation.script "instrumentation/clock-is-
// held.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the simple-2d harness in validation/simple-2d/harness.ts and
// the spec-derived oracle in validation/simple-2d/geometry.ts — never against
// a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/instrumentation/clock-is-held.test.ts is a scaffold stub and has not been written yet",
);
