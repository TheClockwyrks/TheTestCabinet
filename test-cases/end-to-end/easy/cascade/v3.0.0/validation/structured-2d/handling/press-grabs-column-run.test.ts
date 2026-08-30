// SCAFFOLD PLACEHOLDER — validation/structured-2d/handling/press-grabs-column-run.test.ts
//
// The review item `handling.press-grabs-column-run` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A press on a column card lifts it and the cards below
//
//   The held run is the grabbed card and every face-up card below it, in order.

import { it } from "vitest";

it("handling.press-grabs-column-run — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/handling/press-grabs-column-run.test.ts is a scaffold stub, not a validator",
  );
});
