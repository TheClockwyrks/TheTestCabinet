// SCAFFOLD STUB — NOT A VALIDATOR.
//
// instrumentation/set-score-grants-no-life — Posing the score grants no extra ship
//
// setScore across an EXTRA_LIFE_STEP (10,000) boundary leaves lives exactly as
// it was: the award belongs to the scoring path, and a pose is a precondition.
//
// Declared by test-case.toml as validation.script "instrumentation/set-score-
// grants-no-life.test.ts", so the manifest resolves only while this file
// exists. The Validators stage of the v3.0.0 rework replaces it with the real
// suite, written against the simple-2d harness in
// validation/simple-2d/harness.ts and the spec-derived oracle in
// validation/simple-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/instrumentation/set-score-grants-no-life.test.ts is a scaffold stub and has not been written yet",
);
