// SCAFFOLD PLACEHOLDER — validation/simple-2d/foundations/reject-lower-rank.test.ts
//
// The review item `foundations.reject-lower-rank` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A foundation refuses a lower rank
//
//   A card below the foundation's top rank is refused.

import { it } from "vitest";

it("foundations.reject-lower-rank — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/simple-2d/foundations/reject-lower-rank.test.ts is a scaffold stub, not a validator",
  );
});
