// SCAFFOLD PLACEHOLDER — validation/structured-2d/stock/no-recycle-with-cards.test.ts
//
// The review item `stock.no-recycle-with-cards` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A non-empty stock turns rather than recycles
//
//   Turning a stock holding cards leaves the waste larger, not empty.

import { it } from "vitest";

it("stock.no-recycle-with-cards — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/stock/no-recycle-with-cards.test.ts is a scaffold stub, not a validator",
  );
});
