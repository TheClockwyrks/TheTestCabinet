// SCAFFOLD PLACEHOLDER — validation/none/tableau/build-down-alternating.test.ts
//
// The review item `tableau.build-down-alternating` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A column builds down in alternating color
//
//   A card one rank lower and the opposite color is accepted onto a column's lowest card.

import { it } from "vitest";

it("tableau.build-down-alternating — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/tableau/build-down-alternating.test.ts is a scaffold stub, not a validator",
  );
});
