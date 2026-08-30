// SCAFFOLD PLACEHOLDER — validation/simple-2d/deal/deal-clears-trail.test.ts
//
// The review item `deal.deal-clears-trail` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A deal clears the painted table
//
//   A deal after a cascade reports trailStamps 0 and leaves no painted stamp on the table. specs/deal.md states the clearing as part of what a new deal is, so a build that reads its specs puts it on the deal path and the operation's effect is the real path's effect.

import { it } from "vitest";

it("deal.deal-clears-trail — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/simple-2d/deal/deal-clears-trail.test.ts is a scaffold stub, not a validator",
  );
});
