// SCAFFOLD PLACEHOLDER — validation/structured-2d/stock/turned-cards-face-up.test.ts
//
// The review item `stock.turned-cards-face-up` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Turned cards are face-up
//
//   Every card the turn put on the waste is face-up.

import { it } from "vitest";

it("stock.turned-cards-face-up — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/stock/turned-cards-face-up.test.ts is a scaffold stub, not a validator",
  );
});
