// Spectra — resonance/no-decay: the meter does not decay
//
// SCAFFOLD PLACEHOLDER — NOT THE VALIDATOR. The validator stage replaces this
// file with the suite that decides the point `resonance.no-decay` on the
// `none` configuration, and captures the media `test-case.toml` declares
// for it.
//
// It THROWS rather than passing, on purpose: a point whose suite was never
// written must fail loudly instead of silently scoring.

import { it } from "vitest";

it("The meter does not decay", () => {
  throw new Error(
    "Spectra: validation/none/resonance/no-decay.test.ts is a scaffold placeholder and has not been implemented",
  );
});
