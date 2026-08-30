// SCAFFOLD PLACEHOLDER — validation/none/instrumentation/deterministic-cascade.test.ts
//
// The review item `instrumentation.deterministic-cascade` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   The same seed replays the same cascade
//
//   Two runs from one seed, advanced identically, put every flyer at the same position within 0.5 units.

import { it } from "vitest";

it("instrumentation.deterministic-cascade — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/instrumentation/deterministic-cascade.test.ts is a scaffold stub, not a validator",
  );
});
