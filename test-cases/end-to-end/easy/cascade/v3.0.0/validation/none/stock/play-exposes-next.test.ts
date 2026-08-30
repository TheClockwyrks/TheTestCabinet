// SCAFFOLD PLACEHOLDER — validation/none/stock/play-exposes-next.test.ts
//
// The review item `stock.play-exposes-next` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Playing the top exposes the next
//
//   After the top card leaves, the card beneath it is the waste's top.

import { it } from "vitest";

it("stock.play-exposes-next — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/stock/play-exposes-next.test.ts is a scaffold stub, not a validator",
  );
});
