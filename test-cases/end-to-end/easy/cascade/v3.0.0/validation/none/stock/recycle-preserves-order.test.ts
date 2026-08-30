// SCAFFOLD PLACEHOLDER — validation/none/stock/recycle-preserves-order.test.ts
//
// The review item `stock.recycle-preserves-order` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A recycle preserves the order
//
//   The recycled stock turns the same cards up again in the same order.

import { it } from "vitest";

it("stock.recycle-preserves-order — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/stock/recycle-preserves-order.test.ts is a scaffold stub, not a validator",
  );
});
