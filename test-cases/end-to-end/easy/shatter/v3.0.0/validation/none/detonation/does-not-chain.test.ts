// SCAFFOLD STUB — NOT A VALIDATOR.
//
// detonation/does-not-chain — A torpedo destroys only the rock it strikes
//
// A second rock 20 units from the destroyed one survives the detonation.
//
// Declared by variants/warhead.toml as validation.script "detonation/does-not-
// chain.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the none harness in validation/none/harness.ts and the spec-
// derived oracle in validation/none/geometry.ts — never against a reference
// build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/detonation/does-not-chain.test.ts is a scaffold stub and has not been written yet",
);
