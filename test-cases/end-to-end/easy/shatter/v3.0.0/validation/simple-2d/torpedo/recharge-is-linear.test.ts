// SCAFFOLD STUB — NOT A VALIDATOR.
//
// torpedo/recharge-is-linear — The charge fills at a steady rate
//
// torpedoCharge reads 0.5 at 5 s within 0.03, and 0.25 at 2.5 s within 0.03.
// specs/weapons.md states the charge rises linearly from 0 to 1 over
// TORPEDO_RECHARGE, which is what makes the shape of the refill a rule rather
// than the build's choice; without that statement an ease-in curve or a
// stepped refill would be conformant and would fail.
//
// Declared by variants/warhead.toml as validation.script "torpedo/recharge-is-
// linear.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the simple-2d harness in validation/simple-2d/harness.ts and
// the spec-derived oracle in validation/simple-2d/geometry.ts — never against
// a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/torpedo/recharge-is-linear.test.ts is a scaffold stub and has not been written yet",
);
