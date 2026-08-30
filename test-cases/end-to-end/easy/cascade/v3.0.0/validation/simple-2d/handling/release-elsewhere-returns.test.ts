// SCAFFOLD PLACEHOLDER — validation/simple-2d/handling/release-elsewhere-returns.test.ts
//
// The review item `handling.release-elsewhere-returns` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A release away from any pile returns the run
//
//   A release whose leading card's centre lies in no pile's drop rectangle (specs/table.md) puts the run back in its source column.

import { it } from "vitest";

it("handling.release-elsewhere-returns — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/simple-2d/handling/release-elsewhere-returns.test.ts is a scaffold stub, not a validator",
  );
});
