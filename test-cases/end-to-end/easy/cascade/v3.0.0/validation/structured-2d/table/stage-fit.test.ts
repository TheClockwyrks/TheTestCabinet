// SCAFFOLD PLACEHOLDER — validation/structured-2d/table/stage-fit.test.ts
//
// The review item `table.stage-fit` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   The whole table is on screen
//
//   At four window shapes and two pixel ratios the complete 1280 x 720 table is visible, fitted and centred, with nothing clipped.

import { it } from "vitest";

it("table.stage-fit — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/table/stage-fit.test.ts is a scaffold stub, not a validator",
  );
});
