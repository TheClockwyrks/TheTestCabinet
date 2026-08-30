// SCAFFOLD PLACEHOLDER — validation/simple-2d/cascade/launch-cadence.test.ts
//
// The review item `cascade.launch-cadence` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A card launches every 0.18 s
//
//   Over three seconds advanced in frames of 1/240 s, exactly floor(3 / LAUNCH_INTERVAL) + 1 (17) cards have launched, and the mean gap between successive launches is within 2% of LAUNCH_INTERVAL. The launch rule carries its remainder, so the cadence does not drift and the mean is the honest figure; a per-gap tolerance tighter than a frame would only measure the validator's step.

import { it } from "vitest";

it("cascade.launch-cadence — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/simple-2d/cascade/launch-cadence.test.ts is a scaffold stub, not a validator",
  );
});
