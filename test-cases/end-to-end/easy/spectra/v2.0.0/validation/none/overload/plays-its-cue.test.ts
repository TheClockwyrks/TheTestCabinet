// Spectra — overload/plays-its-cue: an overload plays its own cue
//
// SCAFFOLD PLACEHOLDER — NOT THE VALIDATOR. The validator stage replaces this
// file with the suite that decides the point `overload.plays-its-cue` on the
// `none` configuration, and captures the media `test-case.toml` declares
// for it.
//
// It THROWS rather than passing, on purpose: a point whose suite was never
// written must fail loudly instead of silently scoring.

import { it } from "vitest";

it("An overload plays its own cue", () => {
  throw new Error(
    "Spectra: validation/none/overload/plays-its-cue.test.ts is a scaffold placeholder and has not been implemented",
  );
});
