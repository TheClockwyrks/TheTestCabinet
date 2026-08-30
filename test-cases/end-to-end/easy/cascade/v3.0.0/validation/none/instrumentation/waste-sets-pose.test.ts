// SCAFFOLD PLACEHOLDER — validation/none/instrumentation/waste-sets-pose.test.ts
//
// The review item `instrumentation.waste-sets-pose` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   The waste's sets are posed and read back
//
//   addWasteSet appends one set and clearWasteSets empties the memory, both reported by wasteSets, and wasteVisibleCount follows the newest entry.

import { it } from "vitest";

it("instrumentation.waste-sets-pose — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/instrumentation/waste-sets-pose.test.ts is a scaffold stub, not a validator",
  );
});
