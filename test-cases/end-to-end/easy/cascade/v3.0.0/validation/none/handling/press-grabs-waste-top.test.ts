// SCAFFOLD PLACEHOLDER — validation/none/handling/press-grabs-waste-top.test.ts
//
// The review item `handling.press-grabs-waste-top` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A press on the waste lifts its top card alone
//
//   The held run holds one card.

import { it } from "vitest";

it("handling.press-grabs-waste-top — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/handling/press-grabs-waste-top.test.ts is a scaffold stub, not a validator",
  );
});
