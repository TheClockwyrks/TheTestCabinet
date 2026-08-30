// SCAFFOLD PLACEHOLDER — validation/structured-2d/table/stock-anchor.test.ts
//
// The review item `table.stock-anchor` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   The stock sits at its anchor
//
//   A card posed on the stock is drawn with its top-left at (224, 24).

import { it } from "vitest";

it("table.stock-anchor — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/table/stock-anchor.test.ts is a scaffold stub, not a validator",
  );
});
