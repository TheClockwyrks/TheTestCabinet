// Spectra — stages/challenge-does-not-scale: a challenge stage does not scale
//
// SCAFFOLD PLACEHOLDER — NOT THE VALIDATOR. The validator stage replaces this
// file with the suite that decides the point `stages.challenge-does-not-scale` on the
// `none` configuration, and captures the media `test-case.toml` declares
// for it.
//
// It THROWS rather than passing, on purpose: a point whose suite was never
// written must fail loudly instead of silently scoring.

import { it } from "vitest";

it("A challenge stage does not scale", () => {
  throw new Error(
    "Spectra: validation/none/stages/challenge-does-not-scale.test.ts is a scaffold placeholder and has not been implemented",
  );
});
