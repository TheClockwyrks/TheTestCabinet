// SCAFFOLD PLACEHOLDER — validation/none/handling/sweep-resolves-per-sample.test.ts
//
// The review item `handling.sweep-resolves-per-sample` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Every pointer sample a frame delivers is answered
//
//   A press on a column's lowest card, a move across the table and a release over a legal target, all delivered to the real pointer before a single frame's update, still lift the run and complete the drop. A build that folds only the frame's last sample sees the release alone, lifts nothing and fails.

import { it } from "vitest";

it("handling.sweep-resolves-per-sample — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/handling/sweep-resolves-per-sample.test.ts is a scaffold stub, not a validator",
  );
});
