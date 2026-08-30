// SCAFFOLD PLACEHOLDER — validation/none/stock/empty-stock-recycles.test.ts
//
// The review item `stock.empty-stock-recycles` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   An empty stock recycles the waste
//
//   Turning an empty stock returns every waste card to the stock, face-down.

import { it } from "vitest";

it("stock.empty-stock-recycles — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/stock/empty-stock-recycles.test.ts is a scaffold stub, not a validator",
  );
});
