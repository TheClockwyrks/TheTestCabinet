// SCAFFOLD PLACEHOLDER — validation/none/instrumentation/add-card-appends.test.ts
//
// The review item `instrumentation.add-card-appends` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   addCard appends to the pile's top
//
//   A card added to a pile holding two cards is the pile's third and last entry.

import { it } from "vitest";

it("instrumentation.add-card-appends — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/instrumentation/add-card-appends.test.ts is a scaffold stub, not a validator",
  );
});
