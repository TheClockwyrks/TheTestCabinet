// Spectra — stages/challenge-non-firing: a challenge stage never fires
//
// SCAFFOLD PLACEHOLDER — NOT THE VALIDATOR. The validator stage replaces this
// file with the suite that decides the point `stages.challenge-non-firing` on the
// `simple-2d` configuration, and captures the media `test-case.toml` declares
// for it.
//
// It THROWS rather than passing, on purpose: a point whose suite was never
// written must fail loudly instead of silently scoring.

import { it } from "vitest";

it("A challenge stage never fires", () => {
  throw new Error(
    "Spectra: validation/simple-2d/stages/challenge-non-firing.test.ts is a scaffold placeholder and has not been implemented",
  );
});
