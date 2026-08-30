// Spectra — stages/challenge-every-third: every third stage is a challenge stage
//
// SCAFFOLD PLACEHOLDER — NOT THE VALIDATOR. The validator stage replaces this
// file with the suite that decides the point `stages.challenge-every-third` on the
// `none` configuration, and captures the media `test-case.toml` declares
// for it.
//
// It THROWS rather than passing, on purpose: a point whose suite was never
// written must fail loudly instead of silently scoring.

import { it } from "vitest";

it("Every third stage is a challenge stage", () => {
  throw new Error(
    "Spectra: validation/none/stages/challenge-every-third.test.ts is a scaffold placeholder and has not been implemented",
  );
});
