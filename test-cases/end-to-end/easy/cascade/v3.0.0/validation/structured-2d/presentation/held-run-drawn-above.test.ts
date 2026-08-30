// SCAFFOLD PLACEHOLDER — validation/structured-2d/presentation/held-run-drawn-above.test.ts
//
// The review item `presentation.held-run-drawn-above` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A held run is drawn over the piles
//
//   The pixels where a held run overlaps a pile are the run's.

import { it } from "vitest";

it("presentation.held-run-drawn-above — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/presentation/held-run-drawn-above.test.ts is a scaffold stub, not a validator",
  );
});
