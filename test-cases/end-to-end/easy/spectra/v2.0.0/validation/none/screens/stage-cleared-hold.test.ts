// Spectra — screens/stage-cleared-hold: the stage-cleared screen gives way
//
// SCAFFOLD PLACEHOLDER — NOT THE VALIDATOR. The validator stage replaces this
// file with the suite that decides the point `screens.stage-cleared-hold` on the
// `none` configuration, and captures the media `test-case.toml` declares
// for it.
//
// It THROWS rather than passing, on purpose: a point whose suite was never
// written must fail loudly instead of silently scoring.

import { it } from "vitest";

it("The stage-cleared screen gives way", () => {
  throw new Error(
    "Spectra: validation/none/screens/stage-cleared-hold.test.ts is a scaffold placeholder and has not been implemented",
  );
});
