// SCAFFOLD STUB — NOT A VALIDATOR.
//
// lives/invuln-window — The respawn grace opens at 2.5 seconds
//
// ship.invuln is INVULN_TIME (2.5) within one tick immediately after the
// respawn.
//
// Declared by test-case.toml as validation.script "lives/invuln-
// window.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the simple-2d harness in validation/simple-2d/harness.ts and
// the spec-derived oracle in validation/simple-2d/geometry.ts — never against
// a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/lives/invuln-window.test.ts is a scaffold stub and has not been written yet",
);
