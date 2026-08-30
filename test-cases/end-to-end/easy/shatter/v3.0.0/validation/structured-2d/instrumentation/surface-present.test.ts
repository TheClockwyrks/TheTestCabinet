// SCAFFOLD STUB — NOT A VALIDATOR.
//
// instrumentation/surface-present — The debug surface is present and complete
//
// Every operation specs/instrumentation.md names is a function on the surface,
// version is SHATTER_DEBUG_VERSION (1), and the surface is live: a posed rock
// reads back and drifts when the game is advanced.
//
// Declared by test-case.toml as validation.script "instrumentation/surface-
// present.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the structured-2d harness in
// validation/structured-2d/harness.ts and the spec-derived oracle in
// validation/structured-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/instrumentation/surface-present.test.ts is a scaffold stub and has not been written yet",
);
