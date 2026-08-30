// SCAFFOLD PLACEHOLDER — validation/none/instrumentation/card-ids-stable.test.ts
//
// The review item `instrumentation.card-ids-stable` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A card keeps its id across a move
//
//   A card moved from a column to a foundation is reported with the id it carried before the move.

import { it } from "vitest";

it("instrumentation.card-ids-stable — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/instrumentation/card-ids-stable.test.ts is a scaffold stub, not a validator",
  );
});
