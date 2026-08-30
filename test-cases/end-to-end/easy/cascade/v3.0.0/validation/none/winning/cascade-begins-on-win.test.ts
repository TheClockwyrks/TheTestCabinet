// SCAFFOLD PLACEHOLDER — validation/none/winning/cascade-begins-on-win.test.ts
//
// The review item `winning.cascade-begins-on-win` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   The cascade begins with the win
//
//   The first card launches on the cascade's first frame.

import { it } from "vitest";

it("winning.cascade-begins-on-win — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/winning/cascade-begins-on-win.test.ts is a scaffold stub, not a validator",
  );
});
