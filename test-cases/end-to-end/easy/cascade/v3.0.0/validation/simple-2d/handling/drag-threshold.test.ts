// SCAFFOLD PLACEHOLDER — validation/simple-2d/handling/drag-threshold.test.ts
//
// The review item `handling.drag-threshold` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A short gesture is a click, not a drop
//
//   A press on a column's lowest card, a move of 4 units toward a legal target and a release leaves the card in its source column, because the release lies within DRAG_THRESHOLD (5) of its press and is therefore a click; the same gesture moving 6 units completes the drop onto that target.

import { it } from "vitest";

it("handling.drag-threshold — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/simple-2d/handling/drag-threshold.test.ts is a scaffold stub, not a validator",
  );
});
