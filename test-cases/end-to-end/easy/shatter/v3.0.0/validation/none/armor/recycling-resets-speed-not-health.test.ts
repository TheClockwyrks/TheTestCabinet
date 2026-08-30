// SCAFFOLD STUB — NOT A VALIDATOR.
//
// rocks/recycling-resets-speed-not-health — Recycling resets the speed and not the health
//
// The same recycled rock re-enters at a speed inside [60, 110] while still
// reporting health 1.
//
// Declared by variants/warhead.toml as validation.script "armor/recycling-
// resets-speed-not-health.test.ts", so the manifest resolves only while this
// file exists. The Validators stage of the v3.0.0 rework replaces it with the
// real suite, written against the none harness in validation/none/harness.ts
// and the spec-derived oracle in validation/none/geometry.ts — never against a
// reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/armor/recycling-resets-speed-not-health.test.ts is a scaffold stub and has not been written yet",
);
