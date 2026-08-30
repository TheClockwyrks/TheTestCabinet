// SCAFFOLD STUB — NOT A VALIDATOR.
//
// torpedo/homing-cone-is-forward-only — The cone looks forward alone
//
// A rock placed directly behind a torpedo is never acquired: the torpedo's
// heading is unchanged over a second and the rock survives.
//
// Declared by variants/warhead.toml as validation.script "torpedo/homing-cone-
// is-forward-only.test.ts", so the manifest resolves only while this file
// exists. The Validators stage of the v3.0.0 rework replaces it with the real
// suite, written against the structured-2d harness in
// validation/structured-2d/harness.ts and the spec-derived oracle in
// validation/structured-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/torpedo/homing-cone-is-forward-only.test.ts is a scaffold stub and has not been written yet",
);
