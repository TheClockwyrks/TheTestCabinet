// SCAFFOLD PLACEHOLDER — validation/none/foundations/pull-back-to-tableau.test.ts
//
// The review item `foundations.pull-back-to-tableau` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A foundation's top card may be pulled back
//
//   A foundation's top card is accepted onto a legal column and leaves the foundation.

import { it } from "vitest";

it("foundations.pull-back-to-tableau — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/foundations/pull-back-to-tableau.test.ts is a scaffold stub, not a validator",
  );
});
