// SCAFFOLD STUB — NOT A VALIDATOR.
//
// lives/a-fast-approach-still-costs-a-life — A rock closing fast is not passed through
//
// With the contact gate on, a Small posed one tick's travel from the ship and
// closing at 1200 units per second — a per-tick step of 10 units against a
// combined radius of SHIP_R + ROCK_RADIUS.small (28) — costs exactly one life
// on the next tick. This is the ship's half of the swept-or-continuous
// requirement specs/collision.md states; bullets/no-tunnelling-at-speed is the
// bullet's.
//
// Declared by test-case.toml as validation.script "lives/a-fast-approach-
// still-costs-a-life.test.ts", so the manifest resolves only while this file
// exists. The Validators stage of the v3.0.0 rework replaces it with the real
// suite, written against the structured-2d harness in
// validation/structured-2d/harness.ts and the spec-derived oracle in
// validation/structured-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/lives/a-fast-approach-still-costs-a-life.test.ts is a scaffold stub and has not been written yet",
);
