// SCAFFOLD STUB — NOT A VALIDATOR.
//
// gravity/softening-cap — The pull is capped inside the softening radius
//
// A bullet posed at rest 60 units from the star gains velocity over one tick
// within 5 percent of MU / SOFTEN^2 x TICK_DT, not of MU / 60^2 x TICK_DT.
//
// Declared by test-case.toml as validation.script "gravity/softening-
// cap.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the simple-2d harness in validation/simple-2d/harness.ts and
// the spec-derived oracle in validation/simple-2d/geometry.ts — never against
// a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/gravity/softening-cap.test.ts is a scaffold stub and has not been written yet",
);
