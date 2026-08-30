// SCAFFOLD PLACEHOLDER — validation/structured-2d/draw-one/set-falls-back.test.ts
//
// The review item `draw-one.set-falls-back` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   The waste falls back to the earlier turn
//
//   With two turns made and the newer card played home, the waste shows the card the earlier turn left, by identity as well as by count.

import { it } from "vitest";

it("draw-one.set-falls-back — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/draw-one/set-falls-back.test.ts is a scaffold stub, not a validator",
  );
});
