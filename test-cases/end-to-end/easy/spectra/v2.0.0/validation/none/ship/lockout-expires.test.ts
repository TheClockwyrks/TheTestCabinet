// Spectra — ship/lockout-expires: firing works once the lockout elapses
//
// SCAFFOLD PLACEHOLDER — NOT THE VALIDATOR. The validator stage replaces this
// file with the suite that decides the point `ship.lockout-expires` on the
// `none` configuration, and captures the media `test-case.toml` declares
// for it.
//
// It THROWS rather than passing, on purpose: a point whose suite was never
// written must fail loudly instead of silently scoring.

import { it } from "vitest";

it("Firing works once the lockout elapses", () => {
  throw new Error(
    "Spectra: validation/none/ship/lockout-expires.test.ts is a scaffold placeholder and has not been implemented",
  );
});
