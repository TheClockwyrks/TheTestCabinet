// SCAFFOLD PLACEHOLDER — validation/simple-2d/draw-three/fan-clear-of-neighbours.test.ts
//
// The review item `draw-three.fan-clear-of-neighbours` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   The fan clears the stock and the foundations
//
//   The fan's leftmost edge is at or right of 346 and its rightmost edge is left of 590.

import { it } from "vitest";

it("draw-three.fan-clear-of-neighbours — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/simple-2d/draw-three/fan-clear-of-neighbours.test.ts is a scaffold stub, not a validator",
  );
});
