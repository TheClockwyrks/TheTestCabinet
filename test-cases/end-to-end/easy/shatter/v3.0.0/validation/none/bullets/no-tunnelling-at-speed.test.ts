// SCAFFOLD STUB — NOT A VALIDATOR.
//
// bullets/no-tunnelling-at-speed — A fast shot does not pass through a rock
//
// On a quiet field, a bullet posed one tick's travel short of a Small and
// moving through its centre at MUZZLE_SPEED + SHIP_MAX (1200 units per second)
// — a per-tick step of 10 units against a combined radius of BULLET_R +
// ROCK_RADIUS.small (17) — destroys it on the next tick; the same shot offset
// by more than that combined radius misses.
//
// Declared by test-case.toml as validation.script "bullets/no-tunnelling-at-
// speed.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the none harness in validation/none/harness.ts and the spec-
// derived oracle in validation/none/geometry.ts — never against a reference
// build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/bullets/no-tunnelling-at-speed.test.ts is a scaffold stub and has not been written yet",
);
