// SCAFFOLD PLACEHOLDER — validation/none/stock/turn-drains-stock.test.ts
//
// The review item `stock.turn-drains-stock` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Turning drains the stock exactly
//
//   Turning until the stock is empty puts every card on the waste once, with none lost and none duplicated.

import { it } from "vitest";

it("stock.turn-drains-stock — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/stock/turn-drains-stock.test.ts is a scaffold stub, not a validator",
  );
});
