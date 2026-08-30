// SCAFFOLD PLACEHOLDER — validation/none/instrumentation/clear-table.test.ts
//
// The review item `instrumentation.clear-table` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   clearTable empties every pile
//
//   All thirteen piles and the waste's set memory are empty, and the flyers and the gates are untouched.

import { it } from "vitest";

it("instrumentation.clear-table — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/instrumentation/clear-table.test.ts is a scaffold stub, not a validator",
  );
});
