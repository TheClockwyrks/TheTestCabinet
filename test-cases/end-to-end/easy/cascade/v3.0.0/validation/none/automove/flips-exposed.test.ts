// SCAFFOLD PLACEHOLDER — validation/none/automove/flips-exposed.test.ts
//
// The review item `automove.flips-exposed` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   An auto-move turns the card it exposes
//
//   Sending a column's only face-up card home turns the card beneath it.

import { it } from "vitest";

it("automove.flips-exposed — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/automove/flips-exposed.test.ts is a scaffold stub, not a validator",
  );
});
