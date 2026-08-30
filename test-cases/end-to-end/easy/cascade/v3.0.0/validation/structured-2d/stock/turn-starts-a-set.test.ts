// SCAFFOLD PLACEHOLDER — validation/structured-2d/stock/turn-starts-a-set.test.ts
//
// The review item `stock.turn-starts-a-set` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Each turn adds one set
//
//   A turn appends exactly one entry to wasteSets, holding the cards it turned.

import { it } from "vitest";

it("stock.turn-starts-a-set — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/stock/turn-starts-a-set.test.ts is a scaffold stub, not a validator",
  );
});
