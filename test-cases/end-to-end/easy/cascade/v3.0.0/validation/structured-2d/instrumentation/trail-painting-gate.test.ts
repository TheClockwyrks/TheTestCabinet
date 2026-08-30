// SCAFFOLD PLACEHOLDER — validation/structured-2d/instrumentation/trail-painting-gate.test.ts
//
// The review item `instrumentation.trail-painting-gate` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   The trail's painting is gated
//
//   With setTrailPainting(false) a second of flight leaves trailStamps where it was and the painted layer takes no new stamp, while the flyer still moves and is still drawn; with the gate on the same second raises trailStamps.

import { it } from "vitest";

it("instrumentation.trail-painting-gate — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/instrumentation/trail-painting-gate.test.ts is a scaffold stub, not a validator",
  );
});
