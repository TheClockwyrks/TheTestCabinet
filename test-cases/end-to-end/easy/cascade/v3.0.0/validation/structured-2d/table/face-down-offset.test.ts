// SCAFFOLD PLACEHOLDER — validation/structured-2d/table/face-down-offset.test.ts
//
// The review item `table.face-down-offset` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A card under a face-down card is offset 24
//
//   In a posed column, the card below a face-down card is drawn 24 units lower.

import { it } from "vitest";

it("table.face-down-offset — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/table/face-down-offset.test.ts is a scaffold stub, not a validator",
  );
});
