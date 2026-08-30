// SCAFFOLD STUB — NOT A VALIDATOR.
//
// saucer/avoids-the-core — A saucer never overlaps the star's core
//
// Across 54 crossings — nine rows from 80 units below the star's row to 80
// above it in 20-unit steps, each from the left edge and from the right, the
// whole set repeated from three seeds, with the gun off — the closest approach
// of any of them to the star's centre, measured as the distance to the line
// between eight-tick samples, exceeds CORE_R + SAUCER_R (48).
//
// Declared by test-case.toml as validation.script "saucer/avoids-the-
// core.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the none harness in validation/none/harness.ts and the spec-
// derived oracle in validation/none/geometry.ts — never against a reference
// build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/saucer/avoids-the-core.test.ts is a scaffold stub and has not been written yet",
);
