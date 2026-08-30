// SCAFFOLD PLACEHOLDER — validation/structured-2d/draw-three/waste-fans-shown-set.test.ts
//
// The review item `draw-three.waste-fans-shown-set` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   The shown set fans to the right
//
//   With three cards on the shown set, they are drawn at 346, 372 and 398, the last of them the playable top card.

import { it } from "vitest";

it("draw-three.waste-fans-shown-set — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/draw-three/waste-fans-shown-set.test.ts is a scaffold stub, not a validator",
  );
});
