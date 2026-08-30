// SCAFFOLD PLACEHOLDER — validation/none/winning/no-win-at-fifty-one.test.ts
//
// The review item `winning.no-win-at-fifty-one` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Fifty-one cards home is not a win
//
//   With one card still out, the game stays on playing.

import { it } from "vitest";

it("winning.no-win-at-fifty-one — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/winning/no-win-at-fifty-one.test.ts is a scaffold stub, not a validator",
  );
});
