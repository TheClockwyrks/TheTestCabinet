// SCAFFOLD PLACEHOLDER — validation/simple-2d/stock/turn-moves-to-waste.test.ts
//
// The review item `stock.turn-moves-to-waste` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A turn moves cards to the waste
//
//   After a turn the stock is smaller by the turn count and the waste larger by the same.

import { it } from "vitest";

it("stock.turn-moves-to-waste — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/simple-2d/stock/turn-moves-to-waste.test.ts is a scaffold stub, not a validator",
  );
});
