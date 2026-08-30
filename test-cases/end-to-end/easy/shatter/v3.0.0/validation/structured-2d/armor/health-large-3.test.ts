// SCAFFOLD STUB — NOT A VALIDATOR.
//
// rocks/health-large-3 — A Large takes three hits
//
// Two rounds leave a Large standing with health 1; the third destroys it.
//
// Declared by variants/warhead.toml as validation.script "armor/health-
// large-3.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the structured-2d harness in
// validation/structured-2d/harness.ts and the spec-derived oracle in
// validation/structured-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/armor/health-large-3.test.ts is a scaffold stub and has not been written yet",
);
