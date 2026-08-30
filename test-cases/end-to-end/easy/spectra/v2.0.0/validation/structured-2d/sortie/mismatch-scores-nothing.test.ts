// Spectra — sortie/mismatch-scores-nothing: a mismatched shot scores nothing
//
// SCAFFOLD PLACEHOLDER — NOT THE VALIDATOR. The validator stage replaces this
// file with the suite that decides the point `sortie.mismatch-scores-nothing` on the
// `structured-2d` configuration, and captures the media `test-case.toml` declares
// for it.
//
// It THROWS rather than passing, on purpose: a point whose suite was never
// written must fail loudly instead of silently scoring.

import { it } from "vitest";

it("A mismatched shot scores nothing", () => {
  throw new Error(
    "Spectra: validation/structured-2d/sortie/mismatch-scores-nothing.test.ts is a scaffold placeholder and has not been implemented",
  );
});
