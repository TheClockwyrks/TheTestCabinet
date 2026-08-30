// SCAFFOLD PLACEHOLDER — validation/simple-2d/presentation/back-distinct-from-face.test.ts
//
// The review item `presentation.back-distinct-from-face` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A card back reads apart from a card face
//
//   The two differ by at least 90 of 441.

import { it } from "vitest";

it("presentation.back-distinct-from-face — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/simple-2d/presentation/back-distinct-from-face.test.ts is a scaffold stub, not a validator",
  );
});
