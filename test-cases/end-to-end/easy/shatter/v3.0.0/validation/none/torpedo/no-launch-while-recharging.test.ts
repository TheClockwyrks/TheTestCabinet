// SCAFFOLD STUB — NOT A VALIDATOR.
//
// torpedo/no-launch-while-recharging — The action does nothing while recharging
//
// With setTorpedoCharge(0.5), driving the binding adds no torpedo.
//
// Declared by variants/warhead.toml as validation.script "torpedo/no-launch-
// while-recharging.test.ts", so the manifest resolves only while this file
// exists. The Validators stage of the v3.0.0 rework replaces it with the real
// suite, written against the none harness in validation/none/harness.ts and
// the spec-derived oracle in validation/none/geometry.ts — never against a
// reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/torpedo/no-launch-while-recharging.test.ts is a scaffold stub and has not been written yet",
);
