// SCAFFOLD PLACEHOLDER — validation/structured-2d/instrumentation/set-card-face.test.ts
//
// The review item `instrumentation.set-card-face` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   setCardFaceUp sets one card's face
//
//   A named card's face is set both ways and no other card's face changes.

import { it } from "vitest";

it("instrumentation.set-card-face — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/instrumentation/set-card-face.test.ts is a scaffold stub, not a validator",
  );
});
