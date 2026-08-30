// SCAFFOLD PLACEHOLDER — validation/simple-2d/stock/set-shrinks-on-play.test.ts
//
// The review item `stock.set-shrinks-on-play` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Playing off the waste shrinks its set
//
//   Playing the top card leaves the newest set one card smaller and wasteVisibleCount one lower.

import { it } from "vitest";

it("stock.set-shrinks-on-play — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/simple-2d/stock/set-shrinks-on-play.test.ts is a scaffold stub, not a validator",
  );
});
