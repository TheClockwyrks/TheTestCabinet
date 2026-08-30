// SCAFFOLD STUB — NOT A VALIDATOR.
//
// torpedo/recharges-in-ten-seconds — The charge refills over ten seconds
//
// torpedoCharge reaches 1 at TORPEDO_RECHARGE (10 s) of game time after a
// launch, within 3 percent.
//
// Declared by variants/warhead.toml as validation.script "torpedo/recharges-
// in-ten-seconds.test.ts", so the manifest resolves only while this file
// exists. The Validators stage of the v3.0.0 rework replaces it with the real
// suite, written against the simple-2d harness in
// validation/simple-2d/harness.ts and the spec-derived oracle in
// validation/simple-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/torpedo/recharges-in-ten-seconds.test.ts is a scaffold stub and has not been written yet",
);
