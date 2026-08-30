// SCAFFOLD PLACEHOLDER — validation/none/instrumentation/launching-gate.test.ts
//
// The review item `instrumentation.launching-gate` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   The cascade's launching is gated
//
//   With setLaunching(false) no further card leaves the foundations over a second of game time while a flyer already in flight keeps moving.

import { it } from "vitest";

it("instrumentation.launching-gate — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/instrumentation/launching-gate.test.ts is a scaffold stub, not a validator",
  );
});
