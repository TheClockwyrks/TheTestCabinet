// SCAFFOLD STUB — NOT A VALIDATOR.
//
// presentation/field-background-is-dark — The field reads as deep space
//
// The field's background, sampled clear of every body, is dark: its luminance
// is below a quarter of full. The bound is the one specs/overview.md states as
// a requirement in its own right; every other item in this group measures
// distance from whatever background the build chose, so this is the only one
// that needs it fixed.
//
// Declared by test-case.toml as validation.script "presentation/field-
// background-is-dark.test.ts", so the manifest resolves only while this file
// exists. The Validators stage of the v3.0.0 rework replaces it with the real
// suite, written against the none harness in validation/none/harness.ts and
// the spec-derived oracle in validation/none/geometry.ts — never against a
// reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/presentation/field-background-is-dark.test.ts is a scaffold stub and has not been written yet",
);
