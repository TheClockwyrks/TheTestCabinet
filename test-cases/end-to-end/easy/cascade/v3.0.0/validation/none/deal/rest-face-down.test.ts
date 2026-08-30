// SCAFFOLD PLACEHOLDER — validation/none/deal/rest-face-down.test.ts
//
// The review item `deal.rest-face-down` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Every other column card is face-down
//
//   The twenty-one cards above the lowest in each column are face-down.

import { it } from "vitest";

it("deal.rest-face-down — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/deal/rest-face-down.test.ts is a scaffold stub, not a validator",
  );
});
