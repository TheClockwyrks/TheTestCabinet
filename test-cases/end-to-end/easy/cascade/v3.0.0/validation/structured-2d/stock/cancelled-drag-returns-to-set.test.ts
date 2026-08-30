// SCAFFOLD PLACEHOLDER — validation/structured-2d/stock/cancelled-drag-returns-to-set.test.ts
//
// The review item `stock.cancelled-drag-returns-to-set` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A cancelled waste drag rejoins its set
//
//   A waste card lifted and released over no target is back on the waste with wasteSets and wasteVisibleCount as they were.

import { it } from "vitest";

it("stock.cancelled-drag-returns-to-set — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/stock/cancelled-drag-returns-to-set.test.ts is a scaffold stub, not a validator",
  );
});
