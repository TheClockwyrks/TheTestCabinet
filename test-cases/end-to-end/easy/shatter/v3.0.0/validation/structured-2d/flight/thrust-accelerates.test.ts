// SCAFFOLD STUB — NOT A VALIDATOR.
//
// flight/thrust-accelerates — Thrust accelerates the ship
//
// Holding thrust for one second from rest leaves the ship's speed at
// SHIP_THRUST (480) less the drag the half-life removes, within 5 percent.
//
// Declared by test-case.toml as validation.script "flight/thrust-
// accelerates.test.ts", so the manifest resolves only while this file exists.
// The Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the structured-2d harness in
// validation/structured-2d/harness.ts and the spec-derived oracle in
// validation/structured-2d/geometry.ts — never against a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/structured-2d/flight/thrust-accelerates.test.ts is a scaffold stub and has not been written yet",
);
