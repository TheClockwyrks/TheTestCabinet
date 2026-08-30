// SCAFFOLD PLACEHOLDER — validation/structured-2d/stock/only-top-playable.test.ts
//
// The review item `stock.only-top-playable` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Only the waste's top card is playable
//
//   A move naming a waste card below the top is refused.

import { it } from "vitest";

it("stock.only-top-playable — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/stock/only-top-playable.test.ts is a scaffold stub, not a validator",
  );
});
