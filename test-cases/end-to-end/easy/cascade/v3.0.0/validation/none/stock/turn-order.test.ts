// SCAFFOLD PLACEHOLDER — validation/none/stock/turn-order.test.ts
//
// The review item `stock.turn-order` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   The last card turned is the waste's top
//
//   Cards are turned one at a time from the top of the stock, so the stock's top card ends up deepest of the turned group.

import { it } from "vitest";

it("stock.turn-order — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/stock/turn-order.test.ts is a scaffold stub, not a validator",
  );
});
