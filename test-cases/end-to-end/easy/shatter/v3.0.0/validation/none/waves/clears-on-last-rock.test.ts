// SCAFFOLD STUB — NOT A VALIDATOR.
//
// waves/clears-on-last-rock — Destroying the last rock turns the wave over
//
// Shooting the field down to one Small, and never using clearRocks, and then
// destroying it raises the banner (waveBanner > 0) on that tick. The
// transition alone: the number the banner announces is wave-number-
// increments's point, and the negative direction is an-empty-field-does-not-
// clear-by-itself's, so a build misses one point per requirement rather than
// three per defect.
//
// Declared by test-case.toml as validation.script "waves/clears-on-last-
// rock.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the none harness in validation/none/harness.ts and the spec-
// derived oracle in validation/none/geometry.ts — never against a reference
// build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/waves/clears-on-last-rock.test.ts is a scaffold stub and has not been written yet",
);
