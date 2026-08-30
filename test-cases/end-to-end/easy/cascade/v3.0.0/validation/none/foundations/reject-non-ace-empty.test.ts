// SCAFFOLD PLACEHOLDER — validation/none/foundations/reject-non-ace-empty.test.ts
//
// The review item `foundations.reject-non-ace-empty` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   An empty foundation refuses everything but an Ace
//
//   A 2 and a King are each refused by an empty foundation.

import { it } from "vitest";

it("foundations.reject-non-ace-empty — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/foundations/reject-non-ace-empty.test.ts is a scaffold stub, not a validator",
  );
});
