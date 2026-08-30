// SCAFFOLD STUB — NOT A VALIDATOR.
//
// waves/wave-one-spawns-four — Wave 1 puts up four Large rocks
//
// The wave that follows a cleared wave 0 holds exactly WAVE_BASE_ROCKS + 1 (4)
// Large rocks.
//
// Declared by test-case.toml as validation.script "waves/wave-one-spawns-
// four.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the structured-2d harness in
// validation/structured-2d/harness.ts and the spec-derived oracle in
// validation/structured-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/waves/wave-one-spawns-four.test.ts is a scaffold stub and has not been written yet",
);
