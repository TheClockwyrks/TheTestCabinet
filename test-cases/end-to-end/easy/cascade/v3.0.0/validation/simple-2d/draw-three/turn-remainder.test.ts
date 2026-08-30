// SCAFFOLD PLACEHOLDER — validation/simple-2d/draw-three/turn-remainder.test.ts
//
// The review item `draw-three.turn-remainder` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A short stock turns all that remain
//
//   A stock holding two cards turns both and adds a set of two.

import { it } from "vitest";

it("draw-three.turn-remainder — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/simple-2d/draw-three/turn-remainder.test.ts is a scaffold stub, not a validator",
  );
});
