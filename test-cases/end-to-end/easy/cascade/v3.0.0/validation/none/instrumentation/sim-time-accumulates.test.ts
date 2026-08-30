// SCAFFOLD PLACEHOLDER — validation/none/instrumentation/sim-time-accumulates.test.ts
//
// The review item `instrumentation.sim-time-accumulates` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   simTime accumulates game time
//
//   Advancing one second raises simTime by one second on every screen.

import { it } from "vitest";

it("instrumentation.sim-time-accumulates — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/instrumentation/sim-time-accumulates.test.ts is a scaffold stub, not a validator",
  );
});
