// SCAFFOLD PLACEHOLDER — validation/structured-2d/winning/win-by-double-click.test.ts
//
// The review item `winning.win-by-double-click` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Double-clicking the last card home wins
//
//   The win is reached by a double click and the cascade is still running when the second press has been handled.

import { it } from "vitest";

it("winning.win-by-double-click — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/winning/win-by-double-click.test.ts is a scaffold stub, not a validator",
  );
});
