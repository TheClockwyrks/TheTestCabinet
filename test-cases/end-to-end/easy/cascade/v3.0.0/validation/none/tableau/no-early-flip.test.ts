// SCAFFOLD PLACEHOLDER — validation/none/tableau/no-early-flip.test.ts
//
// The review item `tableau.no-early-flip` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Lifting a card does not turn the one beneath
//
//   A card lifted with the pointer and released over no target leaves the card beneath face-down throughout.

import { it } from "vitest";

it("tableau.no-early-flip — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/tableau/no-early-flip.test.ts is a scaffold stub, not a validator",
  );
});
