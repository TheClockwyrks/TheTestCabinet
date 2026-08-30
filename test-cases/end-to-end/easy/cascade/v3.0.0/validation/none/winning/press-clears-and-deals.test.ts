// SCAFFOLD PLACEHOLDER — validation/none/winning/press-clears-and-deals.test.ts
//
// The review item `winning.press-clears-and-deals` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A press during the cascade deals a fresh game
//
//   The press deals afresh: trailStamps is 0, a fresh fifty-two-card deal is on the table, and the screen is playing. specs/victory.md states the press and specs/deal.md states the clearing.

import { it } from "vitest";

it("winning.press-clears-and-deals — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/winning/press-clears-and-deals.test.ts is a scaffold stub, not a validator",
  );
});
