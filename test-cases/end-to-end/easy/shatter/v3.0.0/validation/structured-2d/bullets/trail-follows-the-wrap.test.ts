// SCAFFOLD STUB — NOT A VALIDATOR.
//
// bullets/trail-follows-the-wrap — The trail follows a bullet across a seam
//
// A bullet crossing the right edge draws its trail behind it at the left edge
// rather than smearing across the field: no drawn pixel of the trail lies more
// than TRAIL_TICKS of travel from the bullet by shortest wrapped distance.
//
// Declared by test-case.toml as validation.script "bullets/trail-follows-the-
// wrap.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the structured-2d harness in
// validation/structured-2d/harness.ts and the spec-derived oracle in
// validation/structured-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/bullets/trail-follows-the-wrap.test.ts is a scaffold stub and has not been written yet",
);
