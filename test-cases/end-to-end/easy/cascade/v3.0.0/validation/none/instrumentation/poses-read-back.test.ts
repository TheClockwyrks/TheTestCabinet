// SCAFFOLD PLACEHOLDER — validation/none/instrumentation/poses-read-back.test.ts
//
// The review item `instrumentation.poses-read-back` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Every pose is reported by the snapshot
//
//   Each pose's value is read back: the screen, a card's face, the waste's sets, the four gates, a flyer's position and velocity, and the launch clock.

import { it } from "vitest";

it("instrumentation.poses-read-back — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/instrumentation/poses-read-back.test.ts is a scaffold stub, not a validator",
  );
});
