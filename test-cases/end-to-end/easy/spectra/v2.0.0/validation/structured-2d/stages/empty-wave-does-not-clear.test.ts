// Spectra — stages/empty-wave-does-not-clear: an empty wave is playing, not cleared
//
// SCAFFOLD PLACEHOLDER — NOT THE VALIDATOR. The validator stage replaces this
// file with the suite that decides the point `stages.empty-wave-does-not-clear` on the
// `structured-2d` configuration, and captures the media `test-case.toml` declares
// for it.
//
// It THROWS rather than passing, on purpose: a point whose suite was never
// written must fail loudly instead of silently scoring.

import { it } from "vitest";

it("An empty wave is playing, not cleared", () => {
  throw new Error(
    "Spectra: validation/structured-2d/stages/empty-wave-does-not-clear.test.ts is a scaffold placeholder and has not been implemented",
  );
});
