// SCAFFOLD PLACEHOLDER — validation/simple-2d/table/card-size.test.ts
//
// The review item `table.card-size` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A card occupies its footprint
//
//   A drawn card covers 100 x 140 at its position wherever it sits.

import { it } from "vitest";

it("table.card-size — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/simple-2d/table/card-size.test.ts is a scaffold stub, not a validator",
  );
});
