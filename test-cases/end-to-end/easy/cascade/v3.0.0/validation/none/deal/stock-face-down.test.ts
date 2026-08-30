// SCAFFOLD PLACEHOLDER — validation/none/deal/stock-face-down.test.ts
//
// The review item `deal.stock-face-down` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   The stock is face-down
//
//   Every stock card is face-down.

import { it } from "vitest";

it("deal.stock-face-down — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/deal/stock-face-down.test.ts is a scaffold stub, not a validator",
  );
});
