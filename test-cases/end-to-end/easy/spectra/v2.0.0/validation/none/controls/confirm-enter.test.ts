// Spectra — controls/confirm-enter: confirm on Enter
//
// SCAFFOLD PLACEHOLDER — NOT THE VALIDATOR. The validator stage replaces this
// file with the suite that decides the point `controls.confirm-enter` on the
// `none` configuration, and captures the media `test-case.toml` declares
// for it.
//
// It THROWS rather than passing, on purpose: a point whose suite was never
// written must fail loudly instead of silently scoring.

import { it } from "vitest";

it("Confirm on Enter", () => {
  throw new Error(
    "Spectra: validation/none/controls/confirm-enter.test.ts is a scaffold placeholder and has not been implemented",
  );
});
