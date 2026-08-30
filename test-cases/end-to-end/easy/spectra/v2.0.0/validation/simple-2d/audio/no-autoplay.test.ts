// Spectra — audio/no-autoplay: nothing sounds before the first input
//
// SCAFFOLD PLACEHOLDER — NOT THE VALIDATOR. The validator stage replaces this
// file with the suite that decides the point `audio.no-autoplay` on the
// `simple-2d` configuration, and captures the media `test-case.toml` declares
// for it.
//
// It THROWS rather than passing, on purpose: a point whose suite was never
// written must fail loudly instead of silently scoring.

import { it } from "vitest";

it("Nothing sounds before the first input", () => {
  throw new Error(
    "Spectra: validation/simple-2d/audio/no-autoplay.test.ts is a scaffold placeholder and has not been implemented",
  );
});
