// SCAFFOLD STUB — NOT A VALIDATOR.
//
// screens/pause-freezes-the-field — Pausing freezes the field
//
// With a rock drifting, pausing and advancing two seconds leaves every body
// where it stood and every timer where it was, per the rule specs/ui.md states
// that the paused screen advances nothing. simTime still accumulates, which
// the same rule fixes.
//
// Declared by test-case.toml as validation.script "screens/pause-freezes-the-
// field.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the none harness in validation/none/harness.ts and the spec-
// derived oracle in validation/none/geometry.ts — never against a reference
// build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/screens/pause-freezes-the-field.test.ts is a scaffold stub and has not been written yet",
);
