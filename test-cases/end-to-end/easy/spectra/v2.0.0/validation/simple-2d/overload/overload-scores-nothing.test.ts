// Spectra — overload/overload-scores-nothing: an overload scores nothing
//
// SCAFFOLD PLACEHOLDER — NOT THE VALIDATOR. The validator stage replaces this
// file with the suite that decides the point `overload.overload-scores-nothing` on the
// `simple-2d` configuration, and captures the media `test-case.toml` declares
// for it.
//
// It THROWS rather than passing, on purpose: a point whose suite was never
// written must fail loudly instead of silently scoring.

import { it } from "vitest";

it("An overload scores nothing", () => {
  throw new Error(
    "Spectra: validation/simple-2d/overload/overload-scores-nothing.test.ts is a scaffold placeholder and has not been implemented",
  );
});
