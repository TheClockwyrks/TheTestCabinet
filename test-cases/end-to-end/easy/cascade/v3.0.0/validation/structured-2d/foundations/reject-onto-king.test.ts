// SCAFFOLD PLACEHOLDER — validation/structured-2d/foundations/reject-onto-king.test.ts
//
// The review item `foundations.reject-onto-king` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A completed foundation accepts nothing
//
//   A card of any suit is refused by a foundation holding its King.

import { it } from "vitest";

it("foundations.reject-onto-king — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/foundations/reject-onto-king.test.ts is a scaffold stub, not a validator",
  );
});
