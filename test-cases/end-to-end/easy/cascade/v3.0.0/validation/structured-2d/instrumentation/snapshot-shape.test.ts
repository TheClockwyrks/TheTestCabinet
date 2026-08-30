// SCAFFOLD PLACEHOLDER — validation/structured-2d/instrumentation/snapshot-shape.test.ts
//
// The review item `instrumentation.snapshot-shape` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Snapshot reports the full documented shape
//
//   On a posed board carrying cards in all four pile kinds, a waste with two sets, a run in hand over a legal target, and two flyers in flight, every field of the documented shape is present with its documented type.

import { it } from "vitest";

it("instrumentation.snapshot-shape — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/instrumentation/snapshot-shape.test.ts is a scaffold stub, not a validator",
  );
});
