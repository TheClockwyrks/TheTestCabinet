// Spectra — overload/fills-no-resonance: an overload fills nothing
//
// SCAFFOLD PLACEHOLDER — NOT THE VALIDATOR. The validator stage replaces this
// file with the suite that decides the point `overload.fills-no-resonance` on the
// `structured-2d` configuration, and captures the media `test-case.toml` declares
// for it.
//
// It THROWS rather than passing, on purpose: a point whose suite was never
// written must fail loudly instead of silently scoring.

import { it } from "vitest";

it("An overload fills nothing", () => {
  throw new Error(
    "Spectra: validation/structured-2d/overload/fills-no-resonance.test.ts is a scaffold placeholder and has not been implemented",
  );
});
