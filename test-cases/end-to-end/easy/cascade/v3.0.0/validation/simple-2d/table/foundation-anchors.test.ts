// SCAFFOLD PLACEHOLDER — validation/simple-2d/table/foundation-anchors.test.ts
//
// The review item `table.foundation-anchors` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   The four foundations sit at their anchors
//
//   A card posed on each foundation is drawn with its top-left at (FOUNDATION_X[i], 24), and nothing card-sized is drawn at (468, 24).

import { it } from "vitest";

it("table.foundation-anchors — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/simple-2d/table/foundation-anchors.test.ts is a scaffold stub, not a validator",
  );
});
