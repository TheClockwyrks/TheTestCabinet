// SCAFFOLD STUB — NOT A VALIDATOR.
//
// presentation/star-halo-fades-outward — The star's halo fades outward
//
// The pixel difference from the background falls monotonically, within noise,
// from CORE_R out to HALO_R, and nothing of the star is drawn beyond 1.5 x
// HALO_R. specs/field.md states both bounds, so a halo with a bright rim or a
// corona spike fails a rule it was told.
//
// Declared by test-case.toml as validation.script "presentation/star-halo-
// fades-outward.test.ts", so the manifest resolves only while this file
// exists. The Validators stage of the v3.0.0 rework replaces it with the real
// suite, written against the simple-2d harness in
// validation/simple-2d/harness.ts and the spec-derived oracle in
// validation/simple-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/presentation/star-halo-fades-outward.test.ts is a scaffold stub and has not been written yet",
);
