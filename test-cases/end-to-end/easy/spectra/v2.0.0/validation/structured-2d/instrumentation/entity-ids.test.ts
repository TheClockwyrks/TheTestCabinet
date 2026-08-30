// Spectra — instrumentation/entity-ids: every entity carries a distinct, stable id
//
// SCAFFOLD PLACEHOLDER — NOT THE VALIDATOR. The validator stage replaces this
// file with the suite that decides the point `instrumentation.entity-ids` on the
// `structured-2d` configuration, and captures the media `test-case.toml` declares
// for it.
//
// It THROWS rather than passing, on purpose: a point whose suite was never
// written must fail loudly instead of silently scoring.

import { it } from "vitest";

it("Every entity carries a distinct, stable id", () => {
  throw new Error(
    "Spectra: validation/structured-2d/instrumentation/entity-ids.test.ts is a scaffold placeholder and has not been implemented",
  );
});
