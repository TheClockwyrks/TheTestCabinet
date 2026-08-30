// SCAFFOLD STUB — NOT A VALIDATOR.
//
// detonation/harder-scatter — A torpedo blasts fragments harder than the gun
//
// Half the magnitude of the difference between the two fragments' velocities
// is TORPEDO_SCATTER (240) within 10 percent, against SPLIT_KICK (90) for a
// gun kill on the same posed rock; both spreads are read at the instant of
// their own kill.
//
// Declared by variants/warhead.toml as validation.script "detonation/harder-
// scatter.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the structured-2d harness in
// validation/structured-2d/harness.ts and the spec-derived oracle in
// validation/structured-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/detonation/harder-scatter.test.ts is a scaffold stub and has not been written yet",
);
