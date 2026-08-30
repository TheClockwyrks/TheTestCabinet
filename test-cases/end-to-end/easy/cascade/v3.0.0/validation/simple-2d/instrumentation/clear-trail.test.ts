// SCAFFOLD PLACEHOLDER — validation/simple-2d/instrumentation/clear-trail.test.ts
//
// The review item `instrumentation.clear-trail` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   clearTrail empties the painted layer
//
//   After flight has stamped the layer, clearTrail() reports trailStamps 0 and the table carries no painted stamp, while every flyer is still in flight.

import { it } from "vitest";

it("instrumentation.clear-trail — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/simple-2d/instrumentation/clear-trail.test.ts is a scaffold stub, not a validator",
  );
});
