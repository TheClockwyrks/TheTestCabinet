// SCAFFOLD PLACEHOLDER — validation/structured-2d/presentation/red-black-distinct.test.ts
//
// The review item `presentation.red-black-distinct` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Red and black suits are told apart
//
//   The colors a heart and a spade are drawn in differ by at least 90 of 441 in RGB distance.

import { it } from "vitest";

it("presentation.red-black-distinct — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/presentation/red-black-distinct.test.ts is a scaffold stub, not a validator",
  );
});
