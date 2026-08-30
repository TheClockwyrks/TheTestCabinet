// SCAFFOLD PLACEHOLDER — validation/none/tableau/flip-exposed.test.ts
//
// The review item `tableau.flip-exposed` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A newly exposed card turns face-up
//
//   A move taking a column's only face-up card leaves the card beneath it face-up.

import { it } from "vitest";

it("tableau.flip-exposed — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/tableau/flip-exposed.test.ts is a scaffold stub, not a validator",
  );
});
