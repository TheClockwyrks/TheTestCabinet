// SCAFFOLD STUB — NOT A VALIDATOR.
//
// torpedo/does-not-inherit-the-ships-drift — A torpedo carries none of the ship's drift
//
// Launched from a ship moving at 300 units per second across its facing, the
// torpedo's velocity is TORPEDO_SPEED along the facing within 3 percent, with
// no component of the drift.
//
// Declared by variants/warhead.toml as validation.script "torpedo/does-not-
// inherit-the-ships-drift.test.ts", so the manifest resolves only while this
// file exists. The Validators stage of the v3.0.0 rework replaces it with the
// real suite, written against the none harness in validation/none/harness.ts
// and the spec-derived oracle in validation/none/geometry.ts — never against a
// reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/torpedo/does-not-inherit-the-ships-drift.test.ts is a scaffold stub and has not been written yet",
);
