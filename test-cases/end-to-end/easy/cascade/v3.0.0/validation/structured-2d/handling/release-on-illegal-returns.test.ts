// SCAFFOLD PLACEHOLDER — validation/structured-2d/handling/release-on-illegal-returns.test.ts
//
// The review item `handling.release-on-illegal-returns` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A release over an illegal pile returns the run
//
//   The run is back in its source column, in order.

import { it } from "vitest";

it("handling.release-on-illegal-returns — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/handling/release-on-illegal-returns.test.ts is a scaffold stub, not a validator",
  );
});
