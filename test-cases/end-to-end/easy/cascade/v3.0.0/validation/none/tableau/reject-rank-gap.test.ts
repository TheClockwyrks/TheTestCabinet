// SCAFFOLD PLACEHOLDER — validation/none/tableau/reject-rank-gap.test.ts
//
// The review item `tableau.reject-rank-gap` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A column refuses a rank gap
//
//   A card two ranks lower and opposite in colour is refused.

import { it } from "vitest";

it("tableau.reject-rank-gap — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/tableau/reject-rank-gap.test.ts is a scaffold stub, not a validator",
  );
});
