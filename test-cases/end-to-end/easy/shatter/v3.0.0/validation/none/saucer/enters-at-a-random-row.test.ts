// SCAFFOLD STUB — NOT A VALIDATOR.
//
// saucer/enters-at-a-random-row — A saucer enters at a row drawn across the field
//
// Every entry row across sixteen arrivals under four seeds lies inside
// [SAUCER_R, FIELD_H - SAUCER_R] — the range specs/saucer.md fixes — and the
// sixteen span more than half of it, which a uniform draw clears with room and
// a build entering on one fixed lane does not. The threshold is derived from
// the stated range, not from an observed spread.
//
// Declared by test-case.toml as validation.script "saucer/enters-at-a-random-
// row.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the none harness in validation/none/harness.ts and the spec-
// derived oracle in validation/none/geometry.ts — never against a reference
// build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/saucer/enters-at-a-random-row.test.ts is a scaffold stub and has not been written yet",
);
