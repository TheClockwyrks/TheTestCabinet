// SCAFFOLD PLACEHOLDER — validation/structured-2d/draw-three/set-falls-back.test.ts
//
// The review item `draw-three.set-falls-back` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   The waste remembers what each turn left
//
//   Turn, turn and play one home, turn and play all three home: the waste then shows the two cards the second turn was left with, on a waste still holding five, and the top card is the one that turn left.

import { it } from "vitest";

it("draw-three.set-falls-back — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/draw-three/set-falls-back.test.ts is a scaffold stub, not a validator",
  );
});
