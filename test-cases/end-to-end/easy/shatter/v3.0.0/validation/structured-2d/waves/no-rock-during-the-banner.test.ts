// SCAFFOLD STUB — NOT A VALIDATOR.
//
// waves/no-rock-during-the-banner — The field stays empty while the banner runs
//
// No rock is on the field at any tick while the banner is showing.
//
// Declared by test-case.toml as validation.script "waves/no-rock-during-the-
// banner.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the structured-2d harness in
// validation/structured-2d/harness.ts and the spec-derived oracle in
// validation/structured-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/waves/no-rock-during-the-banner.test.ts is a scaffold stub and has not been written yet",
);
