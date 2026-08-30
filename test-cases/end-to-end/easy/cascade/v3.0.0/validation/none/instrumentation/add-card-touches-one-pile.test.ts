// SCAFFOLD PLACEHOLDER — validation/none/instrumentation/add-card-touches-one-pile.test.ts
//
// The review item `instrumentation.add-card-touches-one-pile` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   addCard changes only its own pile
//
//   Adding to one column leaves the other twelve piles and the waste's sets exactly as they were.

import { it } from "vitest";

it("instrumentation.add-card-touches-one-pile — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/instrumentation/add-card-touches-one-pile.test.ts is a scaffold stub, not a validator",
  );
});
