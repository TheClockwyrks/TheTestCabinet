// SCAFFOLD PLACEHOLDER — validation/none/tableau/reject-onto-face-down.test.ts
//
// The review item `tableau.reject-onto-face-down` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A column with a face-down lowest card accepts nothing
//
//   Every card offered to such a column is refused.

import { it } from "vitest";

it("tableau.reject-onto-face-down — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/tableau/reject-onto-face-down.test.ts is a scaffold stub, not a validator",
  );
});
