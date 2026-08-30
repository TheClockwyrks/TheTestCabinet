// SCAFFOLD STUB — NOT A VALIDATOR.
//
// torpedo/at-most-one-in-flight — Only one torpedo is in flight at a time
//
// With one torpedo posed in flight through addTorpedo and the charge posed
// full with setTorpedoCharge(1), driving the torpedo binding leaves the roster
// holding exactly one. Posing the charge full is what makes this a different
// point from no-launch-while-recharging: with the charge spent, the recharge
// rule alone accounts for the refusal and no build could fail the two items
// differently.
//
// Declared by variants/warhead.toml as validation.script "torpedo/at-most-one-
// in-flight.test.ts", so the manifest resolves only while this file exists.
// The Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the simple-2d harness in validation/simple-2d/harness.ts and
// the spec-derived oracle in validation/simple-2d/geometry.ts — never against
// a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/torpedo/at-most-one-in-flight.test.ts is a scaffold stub and has not been written yet",
);
